import { GoogleGenAI } from '@google/genai';
import type { RAGProductContext } from './valioAimoRAG.ts';
import type { TenantPolicy } from '../types/aimogate.ts';

export interface GeminiReasoningResult {
  selectedSku: string;
  packsToOrder: number;
  totalCostEur: number;
  reasoning: string;
  chainOfThought?: string;
  model: string;
  latencyMs: number;
}

export interface GeminiRecipeDeductionResult {
  recipe_name: string;
  servings_or_yield: number;
  yield_unit: string;
  dietary_tags: string[];
  raw_ingredients: Array<{
    ingredient_name: string;
    search_query: string;
    quantity: number;
    unit: string;
    category_hint: string;
    dietary_tags: string[];
    importance: 'essential' | 'flavoring' | 'structure' | 'optional';
    culinary_role: string;
  }>;
  preparation_notes: string;
}

export class GeminiClient {
  private static instance: GeminiClient | null = null;
  private client: GoogleGenAI | null = null;
  private apiKey: string;
  private model: string;

  constructor() {
    this.apiKey =
      process.env.GEMINI_API_KEY ||
      process.env.GOOGLE_API_KEY ||
      '';
    this.model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

    if (this.apiKey) {
      try {
        this.client = new GoogleGenAI({ apiKey: this.apiKey });
      } catch (err) {
        console.warn('[GeminiClient] Initialization notice:', err);
      }
    }
  }

  public static getInstance(): GeminiClient {
    if (!GeminiClient.instance) {
      GeminiClient.instance = new GeminiClient();
    }
    return GeminiClient.instance;
  }

  public isAvailable(): boolean {
    if (process.env.DISABLE_REMOTE_LLM === 'true') {
      return false;
    }
    return Boolean(this.apiKey && this.client);
  }

  public getModelName(): string {
    return this.model;
  }

  /**
   * Autonomous B2B Trade & Procurement Reasoning:
   * Evaluates candidate offers retrieved via RAG against live warehouse inventory,
   * tenant spend policy limits, dietary tags, and optimal unit economics.
   */
  public async reasonProcurement(params: {
    prompt: string;
    candidates: RAGProductContext[];
    policy: TenantPolicy;
    requiredVolume: number;
  }): Promise<GeminiReasoningResult | null> {
    if (!this.isAvailable() || !this.client || params.candidates.length === 0) {
      return null;
    }

    const t0 = Date.now();
    const { prompt, candidates, policy, requiredVolume } = params;

    const candidatesSummary = candidates.slice(0, 6).map((c, i) => {
      return `Option ${i + 1}: SKU "${c.product.id}" - ${c.product.display_name} (${c.product.name_fi || ''})
  Category: ${c.product.category} | Tags: [${c.product.dietary_tags.join(', ')}]
  Pack Format: ${c.product.pack_format} (${c.product.pack_volume_litres}L/kg per pack)
  Wholesale Contract Price: €${c.catalogPriceEur.toFixed(2)}/pack | Normalized Unit Price: €${c.comparisonPriceEur.toFixed(2)}/${c.comparisonUnit}
  Warehouse Inventory: ${c.availablePacks} packs in stock (${c.isAvailable ? 'IN_STOCK' : 'OUT_OF_STOCK'})
  Packs Required to satisfy ${requiredVolume} units: ${c.packsRequired} packs (Total: €${c.totalCostEur.toFixed(2)})`;
    }).join('\n\n');

    const systemInstruction = `You are AimoGate Autonomous B2B Procurement Agent powered by ${this.model} for client "${policy.tenant_name}".
Your task is to select the most cost-effective, policy-compliant, and in-stock product SKU from the retrieved Valio Aimo candidates.
Rules:
1. Prioritize IN_STOCK candidates. If all are out of stock, select the closest candidate so a substitution request can be triggered.
2. Optimize for lowest total wholesale cost and lowest unit price (€/L or €/kg).
3. Respect tenant policy limits (Max auto-approve: €${policy.max_auto_approve_eur}).
4. Output valid JSON only matching the schema:
{
  "selected_sku": string,
  "packs_to_order": number,
  "total_cost_eur": number,
  "reasoning": string,
  "chain_of_thought": string
}`;

    const userPrompt = `Procurement Requirement: "${prompt}" (Required Volume: ${requiredVolume} units)
Tenant: ${policy.tenant_name} (Max Auto-Approve Limit: €${policy.max_auto_approve_eur})

Available Valio Aimo Candidates:
${candidatesSummary}

Select the optimal SKU and return JSON.`;

    try {
      const response = await this.client.models.generateContent({
        model: this.model,
        contents: userPrompt,
        config: {
          systemInstruction,
          responseMimeType: 'application/json',
          temperature: 0.1,
        },
      });

      const text = response.text?.trim() || '';
      if (!text) return null;

      const cleanJson = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
      const parsed = JSON.parse(cleanJson);

      if (!parsed || !parsed.selected_sku) return null;

      const matchedCandidate = candidates.find((c) => c.product.id === String(parsed.selected_sku));
      const packs = Number(parsed.packs_to_order || matchedCandidate?.packsRequired || 1);
      const totalEur = Number(
        parsed.total_cost_eur ||
        (matchedCandidate ? Number((packs * matchedCandidate.catalogPriceEur).toFixed(2)) : 0)
      );

      return {
        selectedSku: String(parsed.selected_sku),
        packsToOrder: packs,
        totalCostEur: totalEur,
        reasoning: String(parsed.reasoning || `Selected by ${this.model} for optimal unit economics and stock availability.`),
        chainOfThought: parsed.chain_of_thought ? String(parsed.chain_of_thought) : undefined,
        model: this.model,
        latencyMs: Math.max(15, Date.now() - t0),
      };
    } catch (err) {
      console.warn(`[GeminiClient] Reasoning inference notice (${(err as Error).message}), falling back to deterministic solver.`);
      return null;
    }
  }

  /**
   * Natural Language Procurement Intent Extraction:
   * Extracts distinct procurement line items (name, quantity, unit, category hint)
   * while filtering out meta-instructions (check price, lock quote, commit order, etc.).
   */
  public async extractProcurementItems(prompt: string): Promise<Array<{
    ingredient_name: string;
    search_query: string;
    quantity: number;
    unit: string;
    category_hint: string;
    dietary_tags: string[];
    importance: 'essential' | 'optional';
  }> | null> {
    if (!this.isAvailable() || !this.client) {
      return null;
    }

    const systemInstruction = `You are an expert commercial procurement analyst for Valio Aimo food wholesaler.
Extract ONLY the actual food, beverage, or kitchen supply products to purchase from the user prompt.
Extract metric quantities (L, kg, boxes, units, etc.) for each item.
CRITICAL: Completely IGNORE and DO NOT extract operational instructions, meta-commands, or constraints such as:
- "check fixed contract prices", "check availability", "check price"
- "lock the quote", "commit the order", "if it complies with our autonomous purchasing rules"
- "for Tuesday morning delivery", "by Friday"

Return strictly valid JSON conforming to this schema:
{
  "items": [
    {
      "ingredient_name": string,
      "search_query": string,
      "quantity": number,
      "unit": "L" | "kg" | "boxes" | "units" | "packs",
      "category_hint": "dairy" | "bakery" | "produce" | "meat" | "beverages" | "plant-based" | "cleaning",
      "dietary_tags": string[],
      "importance": "essential" | "optional"
    }
  ]
}`;

    try {
      const response = await this.client.models.generateContent({
        model: this.model,
        contents: `Extract the physical procurement line items to purchase from this prompt: "${prompt}"`,
        config: {
          systemInstruction,
          responseMimeType: 'application/json',
          temperature: 0.1,
        },
      });

      const text = response.text?.trim() || '';
      if (!text) return null;

      const cleanJson = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
      const parsed = JSON.parse(cleanJson);

      if (!parsed || !Array.isArray(parsed.items) || parsed.items.length === 0) {
        return null;
      }

      return parsed.items.map((item: any) => ({
        ingredient_name: String(item.ingredient_name || ''),
        search_query: String(item.search_query || item.ingredient_name || ''),
        quantity: Number(item.quantity) || 1,
        unit: String(item.unit || 'units'),
        category_hint: String(item.category_hint || 'dairy'),
        dietary_tags: Array.isArray(item.dietary_tags) ? item.dietary_tags.map(String) : [],
        importance: item.importance === 'optional' ? ('optional' as const) : ('essential' as const),
      }));
    } catch (err) {
      console.warn(`[GeminiClient] Intent extraction notice (${(err as Error).message}), falling back to regex parser.`);
      return null;
    }
  }

  /**
   * Culinary Recipe Deduction & Scaling:
   * Deduces raw culinary ingredients, calculates scaled quantities, and maps dietary substitutions.
   */
  public async deduceRecipe(prompt: string): Promise<GeminiRecipeDeductionResult | null> {
    if (!this.isAvailable() || !this.client) {
      return null;
    }

    const systemInstruction = `You are an expert commercial chef and procurement engineer.
When given a recipe name, catering request, or kitchen prompt, deduce all necessary raw commercial food ingredients.
Scale quantities appropriately based on the requested servings or units.
If dietary requirements are stated (e.g. gluten-free, lactose-free, vegan), substitute compliant ingredients (e.g., gluten-free flour instead of wheat flour).
Always return valid JSON conforming to this schema:
{
  "recipe_name": string,
  "servings_or_yield": number,
  "yield_unit": string,
  "dietary_tags": string[],
  "raw_ingredients": [
    {
      "ingredient_name": string,
      "search_query": string,
      "quantity": number,
      "unit": string,
      "category_hint": string,
      "dietary_tags": string[],
      "importance": "essential" | "flavoring" | "structure" | "optional",
      "culinary_role": string
    }
  ],
  "preparation_notes": string
}`;

    try {
      const response = await this.client.models.generateContent({
        model: this.model,
        contents: `Deconstruct this kitchen procurement prompt into raw ingredients and metric quantities: "${prompt}"`,
        config: {
          systemInstruction,
          responseMimeType: 'application/json',
          temperature: 0.1,
        },
      });

      const text = response.text?.trim() || '';
      if (!text) return null;

      const cleanJson = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
      const parsed = JSON.parse(cleanJson) as GeminiRecipeDeductionResult;

      if (!parsed || !Array.isArray(parsed.raw_ingredients) || parsed.raw_ingredients.length === 0) {
        return null;
      }

      return parsed;
    } catch (err) {
      console.warn(`[GeminiClient] Recipe deduction notice (${(err as Error).message}), falling back to culinary ontology.`);
      return null;
    }
  }
}
