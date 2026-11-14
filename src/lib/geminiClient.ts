import { GoogleGenAI } from '@google/genai';
import type { RAGProductContext } from './valioAimoRAG.ts';
import type { TenantPolicy } from '../types/aimogate.ts';

const safeEnv: Record<string, string | undefined> =
  typeof process !== 'undefined' && process.env ? process.env : {};

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

export interface GeminiUnifiedProcurementResult {
  intent: 'dish_deduction' | 'explicit_recipe' | 'pure_ingredients' | 'inquire_stock' | 'inquire_price' | 'inquire_policy' | 'inquire_recipe';
  inquiry_target?: string;
  inquiry_answer?: string;
  dish: {
    name: string;
    servings_or_yield?: number;
    yield_unit?: string;
    cuisine?: string;
    is_recognized_from_ingredients?: boolean;
    missing_staples?: string[];
  } | null;
  dietary_tags: string[];
  items: Array<{
    ingredient_name: string;
    search_query: string;
    quantity: number;
    unit: string;
    category_hint: string;
    dietary_tags: string[];
    importance: 'essential' | 'optional' | 'substitute';
    culinary_role: string;
  }>;
  notes?: string;
}

export class GeminiClient {
  private static instance: GeminiClient | null = null;
  private client: GoogleGenAI | null = null;
  private apiKey: string;
  private model: string;

  constructor() {
    this.apiKey =
      safeEnv.GEMINI_API_KEY ||
      safeEnv.GOOGLE_API_KEY ||
      '';
    this.model = safeEnv.GEMINI_MODEL || 'gemini-flash-latest';

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
    if (safeEnv.DISABLE_REMOTE_LLM === 'true') {
      return false;
    }
    return Boolean(this.apiKey && this.client);
  }

  public getModelName(): string {
    return this.model;
  }

  /**
   * Helper that attempts generation with current model, automatically falling back
   * to active Gemini models (gemini-flash-latest, gemini-3.8-flash) if 404/NOT_FOUND or timeout is returned.
   * Uses Promise.race with an 8-10 second timeout so API hangs fail over to the next candidate model or deterministic engine.
   */
  private async generateContentWithFallback(params: {
    contents: string;
    systemInstruction: string;
    temperature?: number;
  }) {
    if (!this.client) return null;

    const executeModels = async () => {
      const candidateModels = [this.model, 'gemini-flash-latest', 'gemini-pro-latest'];
      const uniqueModels = Array.from(new Set(candidateModels.filter(Boolean)));
      const modelTimeoutMs = 25000;

      for (const model of uniqueModels) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeoutPromise = new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            reject(new Error(`[GeminiClient] Request timed out after ${modelTimeoutMs}ms for model ${model}`));
          }, modelTimeoutMs);
          if (typeof (timer as any)?.unref === 'function') {
            (timer as any).unref();
          }
        });

        try {
          const callPromise = this.client!.models.generateContent({
            model,
            contents: params.contents,
            config: {
              systemInstruction: params.systemInstruction,
              responseMimeType: 'application/json',
              temperature: params.temperature ?? 0.1,
            },
          });

          const response = await Promise.race([callPromise, timeoutPromise]);
          clearTimeout(timer);

          if (model !== this.model) {
            console.log(`[GeminiClient] Automatically switched active model to: ${model}`);
            this.model = model;
          }
          return response;
        } catch (err: any) {
          clearTimeout(timer);
          const msg = String(err?.message || '');
          if (
            msg.includes('timed out') ||
            msg.includes('404') ||
            msg.includes('NOT_FOUND') ||
            msg.includes('no longer available') ||
            msg.includes('RESOURCE_EXHAUSTED') ||
            msg.includes('503') ||
            msg.includes('overloaded')
          ) {
            console.warn(`[GeminiClient] Model '${model}' unavailable or timed out (${msg.slice(0, 100)}...), trying fallback...`);
            continue;
          }
          console.warn(`[GeminiClient] Model '${model}' error (${msg.slice(0, 100)}...), trying fallback...`);
          continue;
        }
      }
      return null;
    };

    let overallTimer: ReturnType<typeof setTimeout> | undefined;
    const overallTimeoutMs = 30000;
    const overallTimeoutPromise = new Promise<null>((resolve) => {
      overallTimer = setTimeout(() => {
        console.warn(`[GeminiClient] Total generateContentWithFallback timed out after ${overallTimeoutMs}ms, falling back.`);
        resolve(null);
      }, overallTimeoutMs);
      if (typeof (overallTimer as any)?.unref === 'function') {
        (overallTimer as any).unref();
      }
    });

    try {
      return await Promise.race([executeModels(), overallTimeoutPromise]);
    } finally {
      clearTimeout(overallTimer);
    }
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
      const response = await this.generateContentWithFallback({
        contents: userPrompt,
        systemInstruction,
        temperature: 0.1,
      });

      const text = response?.text?.trim() || '';
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
      const response = await this.generateContentWithFallback({
        contents: `Extract the physical procurement line items to purchase from this prompt: "${prompt}"`,
        systemInstruction,
        temperature: 0.1,
      });

      const text = response?.text?.trim() || '';
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
      const response = await this.generateContentWithFallback({
        contents: `Deconstruct this kitchen procurement prompt into raw ingredients and metric quantities: "${prompt}"`,
        systemInstruction,
        temperature: 0.1,
      });

      const text = response?.text?.trim() || '';
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

  /**
   * Unified Procurement & Culinary Intent Analysis:
   * Bridges dish/recipe deduction, explicit hybrid recipes, and pure ingredient classification.
   * If pure ingredients form a known dish (e.g. flour + butter + sugar + yeast = pulla), recognizes dish context.
   */
  public async analyzeProcurementIntent(prompt: string): Promise<GeminiUnifiedProcurementResult | null> {
    if (!this.isAvailable() || !this.client) {
      return null;
    }

    const systemInstruction = `You are an expert commercial chef, B2B procurement analyst, and food wholesale assistant for Valio Aimo.
Classify the user prompt into one of the following operational archetypes:
1. "dish_deduction": The user specified a finished dish, catering goal, or serving count without listing exact ingredients (e.g. "We need salmon soup for 50 people", "Bake 200 cinnamon buns", "Brownies for 30 guests"). DEDUCE the 4 to 8 primary raw commercial food ingredients scaled to the requested yield/servings.
2. "explicit_recipe": The user specified a recipe/dish context AND specific raw ingredients/quantities (e.g. "Pizza ingredients: 50 bases, 20kg mozzarella, 10kg tomato sauce"). Extract their exact quantities while preserving the dish name, cuisine, and culinary roles.
3. "pure_ingredients": The user is ordering/restocking commodities directly (e.g. "150 litres milk, 15 kg butter"). Extract the physical items. If these ingredients clearly constitute a recognizable dish (e.g. flour + butter + sugar + yeast + cardamom -> Pulla / Cinnamon Buns), identify the dish in dish.name and set is_recognized_from_ingredients: true; otherwise dish should be null.
4. "inquire_stock": The user is asking about product inventory, availability, or whether an item is in stock (e.g. "Check stock of oat milk", "Is butter in stock?"). Do NOT place an order. Extract the product in inquiry_target.
5. "inquire_price": The user is asking about pricing or cost (e.g. "How much does 500L milk cost?", "What is the price of butter?"). Do NOT place an order. Extract the product in inquiry_target.
6. "inquire_policy": The user is asking about spend limits, budget, category quotas, storage rules, or guardrails (e.g. "What is our spend limit for dairy?", "Can I order 500L milk within policy?"). Do NOT place an order.
7. "inquire_recipe": The user is asking what ingredients or proportions are in a recipe without ordering (e.g. "What ingredients do I need for tiramisu?"). Provide the culinary answer in inquiry_answer.

CRITICAL: Completely IGNORE and DO NOT extract operational instructions as products (e.g. "check prices", "lock quote", "commit order", "autonomous purchasing rules", "for Tuesday delivery").

Return strictly valid JSON conforming to this schema:
{
  "intent": "dish_deduction" | "explicit_recipe" | "pure_ingredients" | "inquire_stock" | "inquire_price" | "inquire_policy" | "inquire_recipe",
  "inquiry_target": string | null,
  "inquiry_answer": string | null,
  "dish": {
    "name": string,
    "servings_or_yield": number,
    "yield_unit": string,
    "cuisine": string,
    "is_recognized_from_ingredients": boolean,
    "missing_staples": string[]
  } | null,
  "dietary_tags": string[],
  "items": [
    {
      "ingredient_name": string,
      "search_query": string,
      "quantity": number,
      "unit": "L" | "kg" | "boxes" | "units" | "packs",
      "category_hint": "dairy" | "bakery" | "produce" | "meat" | "beverages" | "plant-based" | "cleaning",
      "dietary_tags": string[],
      "importance": "essential" | "optional" | "substitute",
      "culinary_role": string
    }
  ],
  "notes": string
}`;

    try {
      const response = await this.generateContentWithFallback({
        contents: `Classify the intent and extract commercial procurement items for: "${prompt}"`,
        systemInstruction,
        temperature: 0.1,
      });

      const text = response?.text?.trim() || '';
      if (!text) return null;

      const cleanJson = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
      const parsed = JSON.parse(cleanJson) as GeminiUnifiedProcurementResult;

      if (!parsed) {
        return null;
      }

      const isInformational =
        parsed.intent === 'inquire_stock' ||
        parsed.intent === 'inquire_price' ||
        parsed.intent === 'inquire_policy' ||
        parsed.intent === 'inquire_recipe';

      if (!isInformational && (!Array.isArray(parsed.items) || parsed.items.length === 0)) {
        return null;
      }

      return {
        intent: parsed.intent || 'pure_ingredients',
        inquiry_target: parsed.inquiry_target ? String(parsed.inquiry_target) : undefined,
        inquiry_answer: parsed.inquiry_answer ? String(parsed.inquiry_answer) : undefined,
        dish: parsed.dish && parsed.dish.name ? {
          name: String(parsed.dish.name),
          servings_or_yield: typeof parsed.dish.servings_or_yield === 'number' ? parsed.dish.servings_or_yield : undefined,
          yield_unit: parsed.dish.yield_unit ? String(parsed.dish.yield_unit) : undefined,
          cuisine: parsed.dish.cuisine ? String(parsed.dish.cuisine) : undefined,
          is_recognized_from_ingredients: Boolean(parsed.dish.is_recognized_from_ingredients),
          missing_staples: Array.isArray(parsed.dish.missing_staples) ? parsed.dish.missing_staples.map(String) : [],
        } : null,
        dietary_tags: Array.isArray(parsed.dietary_tags) ? parsed.dietary_tags.map(String) : [],
        items: Array.isArray(parsed.items) ? parsed.items.map((item) => ({
          ingredient_name: String(item.ingredient_name || ''),
          search_query: String(item.search_query || item.ingredient_name || ''),
          quantity: Number(item.quantity) || 1,
          unit: String(item.unit || 'units'),
          category_hint: String(item.category_hint || 'dairy'),
          dietary_tags: Array.isArray(item.dietary_tags) ? item.dietary_tags.map(String) : [],
          importance: (item.importance === 'optional' || item.importance === 'substitute' ? item.importance : 'essential') as 'essential' | 'optional' | 'substitute',
          culinary_role: String(item.culinary_role || 'Commercial kitchen material'),
        })) : [],
        notes: String(parsed.notes || `Processed via Google Gemini (${this.model}) Unified Culinary Engine.`),
      };
    } catch (err) {
      console.warn(`[GeminiClient] Unified intent notice (${(err as Error).message}), falling back to local preprocessor.`);
      return null;
    }
  }
}
