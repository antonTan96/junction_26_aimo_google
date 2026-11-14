import type { RAGProductContext } from './valioAimoRAG.ts';
import type { TenantPolicy } from '../types/aimogate.ts';

export interface NemotronReasoningResult {
  selectedSku: string;
  packsToOrder: number;
  totalCostEur: number;
  reasoning: string;
  chainOfThought?: string;
  model: string;
  latencyMs: number;
}

export class NemotronClient {
  private static instance: NemotronClient | null = null;
  private endpoint: string;
  private apiKey: string;
  private model: string;

  constructor() {
    this.endpoint =
      process.env.DATACRUNCH_ENDPOINT ||
      'https://containers.datacrunch.io/nemotron-3-5-super-vl-b300/v1';
    this.apiKey =
      process.env.DATACRUNCH_API_KEY ||
      process.env.NVIDIA_API_KEY ||
      'dc_176bde1bc2f74ecb83a0640d93d6bb20589aa5d227eaf9fd7208fe2985f7ded208b41c8f4049cf95c838f57290f0c94dfb8d0f4e93de8327352454c4ca19f230429045b393256b150e50a5738583b6b6e58e129bf00a0757a7b1b88c75c44118d1553782e5d0988f7698d3558c4b2ea2f8f974baee5038ebf153ac3bf671201a';
    this.model = process.env.DATACRUNCH_MODEL || 'nemotron-3.5-super-vl';
  }

  public static getInstance(): NemotronClient {
    if (!NemotronClient.instance) {
      NemotronClient.instance = new NemotronClient();
    }
    return NemotronClient.instance;
  }

  public getModelName(): string {
    return this.model;
  }

  public getEndpoint(): string {
    return this.endpoint;
  }

  /**
   * Invoke NVIDIA Nemotron 3.5 Super VL hosted on DataCrunch B300
   * to reason over retrieved Valio Aimo candidates, live stock, and hotel policy constraints.
   */
  public async reasonProcurement(params: {
    prompt: string;
    candidates: RAGProductContext[];
    policy: TenantPolicy;
    requiredVolume: number;
  }): Promise<NemotronReasoningResult | null> {
    const t0 = Date.now();
    const { prompt, candidates, policy, requiredVolume } = params;

    if (candidates.length === 0) return null;

    // Allow opting out or skipping in fast unit-test suites if explicitly disabled
    if (process.env.DISABLE_REMOTE_LLM === 'true') {
      return null;
    }

    const candidatesSummary = candidates.slice(0, 5).map((c, i) => {
      return `Option ${i + 1}: SKU "${c.product.id}" - ${c.product.display_name} (${c.product.name_fi})
  Pack: ${c.product.pack_format} (${c.product.pack_volume_litres}L/kg per pack)
  Catalog Price: €${c.catalogPriceEur.toFixed(2)}/pack | Comp Price: €${c.comparisonPriceEur.toFixed(2)}/${c.comparisonUnit}
  Warehouse Stock: ${c.availablePacks} packs (${c.isAvailable ? 'AVAILABLE' : 'BLOCKED'})
  Required for ${requiredVolume} units: ${c.packsRequired} packs (Est Cost: €${c.totalCostEur.toFixed(2)})`;
    }).join('\n\n');

    const systemPrompt = `You are AimoGate AI Buyer Agent powered by NVIDIA Nemotron-3.5-Super-VL on DataCrunch B300 for ${policy.tenant_name}.
Select the most cost-effective and available product SKU from the candidates.
Keep your reasoning concise (under 80 words).
Output valid JSON only with keys: "selected_sku", "packs_to_order", "total_cost_eur", "reasoning".`;

    const userMessage = `Requirement: "${prompt}" (${requiredVolume} units needed)
Max Auto-Approve Budget: €${policy.max_auto_approve_eur}

Valio Aimo Candidates:
${candidatesSummary}

Select the optimal SKU and return JSON.`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000); // 12s safety timeout

    try {
      const url = `${this.endpoint.replace(/\/+$/, '')}/chat/completions`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage },
          ],
          response_format: { type: 'json_object' },
          max_tokens: 1536,
          temperature: 0.1,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!res.ok) {
        const errorText = await res.text();
        console.warn(`[NemotronClient] API returned error ${res.status}: ${errorText}`);
        return null;
      }

      const data = (await res.json()) as any;
      const choice = data.choices?.[0];
      const message = choice?.message;
      const rawContent = (message?.content || '').trim();
      const chainOfThought = message?.reasoning || undefined;

      const cleanJson = rawContent
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/```\s*$/i, '')
        .trim();

      let parsed: any = null;
      try {
        parsed = JSON.parse(cleanJson);
      } catch {
        // Regex recovery if JSON was slightly truncated
        const skuMatch = cleanJson.match(/"selected_sku":\s*"([^"]+)"/);
        const packsMatch = cleanJson.match(/"packs_to_order":\s*(\d+)/);
        const costMatch = cleanJson.match(/"total_cost_eur":\s*([\d.]+)/);
        const reasoningMatch = cleanJson.match(/"reasoning":\s*"([^"\\]*(?:\\.[^"\\]*)*)/);

        if (skuMatch) {
          parsed = {
            selected_sku: skuMatch[1],
            packs_to_order: packsMatch ? parseInt(packsMatch[1], 10) : undefined,
            total_cost_eur: costMatch ? parseFloat(costMatch[1]) : undefined,
            reasoning: reasoningMatch ? reasoningMatch[1] : 'Nemotron 3.5 Super VL evaluated trade-offs and stock.',
          };
        }
      }

      if (!parsed || !parsed.selected_sku) {
        return null;
      }

      return {
        selectedSku: String(parsed.selected_sku),
        packsToOrder: Number(parsed.packs_to_order || candidates[0].packsRequired),
        totalCostEur: Number(parsed.total_cost_eur || candidates[0].totalCostEur),
        reasoning: String(parsed.reasoning || ''),
        chainOfThought,
        model: this.model,
        latencyMs: Date.now() - t0,
      };
    } catch (err: any) {
      clearTimeout(timeout);
      console.warn(`[NemotronClient] Inference notice (${err.message}), using deterministic unit-economics solver.`);
      return null;
    }
  }
}
