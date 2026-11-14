import { ValioAimoCatalogService, type CatalogProduct } from './valioAimoCatalog.ts';
import { NemotronClient } from './nemotronClient.ts';
import {
  parseBuyerPrompt,
  evaluateOrderPolicy,
  DEFAULT_TENANT_ID,
} from './aimogate.ts';
import type {
  AgentRunResponse,
  AgentStepTrace,
  OrderDTO,
  Principal,
  QuoteLock,
  TenantPolicy,
} from '../types/aimogate.ts';

export interface RAGProductContext {
  product: CatalogProduct;
  catalogPriceEur: number;
  comparisonPriceEur: number;
  comparisonUnit: string;
  isAvailable: boolean;
  availablePacks: number;
  packsRequired: number;
  totalCostEur: number;
  compliancePass: boolean;
  complianceNotes: string[];
}

export interface RAGExecutionResult {
  query: string;
  retrievedCount: number;
  candidates: RAGProductContext[];
  selectedProduct: RAGProductContext | null;
  quoteLocked: QuoteLock | null;
  policyResult: {
    passes: boolean;
    violations: string[];
    requiresHumanSignoff: boolean;
  };
  explanation: string;
  agentResponse: AgentRunResponse;
}

export class ValioAimoRAGService {
  private static instance: ValioAimoRAGService | null = null;
  private catalog = ValioAimoCatalogService.getInstance();

  public static getInstance(): ValioAimoRAGService {
    if (!ValioAimoRAGService.instance) {
      ValioAimoRAGService.instance = new ValioAimoRAGService();
    }
    return ValioAimoRAGService.instance;
  }

  /**
   * Execute Retrieval-Augmented Generation for kitchen procurement:
   * 1. Retrieve candidates from Catalog/MariaDB matching semantic terms.
   * 2. Augment candidates with live Valio Aimo prices and warehouse inventory.
   * 3. Evaluate tenant policy constraints & volume quotas.
   * 4. Synthesize optimal purchase recommendation with audit trace.
   */
  public async executeRAGPipeline(params: {
    prompt: string;
    policy: TenantPolicy;
    existingOrders?: OrderDTO[];
    customer?: string;
  }): Promise<RAGExecutionResult> {
    const t0 = Date.now();
    const { prompt, policy, existingOrders = [], customer = '123' } = params;
    const parsed = parseBuyerPrompt(prompt);
    const traces: AgentStepTrace[] = [];

    // Step 1: Retrieval from Catalog (MariaDB / In-Memory Index)
    const rawCandidates = this.catalog.search(parsed.query, {
      limit: 8,
      tags: parsed.attributes.length > 0 ? parsed.attributes : undefined,
    });

    traces.push({
      step_number: 1,
      title: 'RAG Step 1: Semantic Retrieval over MariaDB Catalog',
      description: `Queried 17,546 Valio Aimo catalog products for intent '${parsed.query}' (tags: ${parsed.attributes.join(', ') || 'none'}). Retrieved ${rawCandidates.length} top candidates.`,
      action_type: 'reasoning',
      latency_ms: Math.max(5, Date.now() - t0),
      tool_input: { prompt, parsed },
      tool_output: rawCandidates.map((c) => ({
        id: c.id,
        name: c.display_name,
        brand: c.brand,
        pack: c.pack_format,
        volume: c.pack_volume_litres,
      })),
    });

    if (rawCandidates.length === 0) {
      const emptyTrace: AgentRunResponse = {
        success: false,
        mode_used: 'rag-augmented',
        execution_time_ms: Date.now() - t0,
        traces,
        final_status: 'NO_OFFERS',
        summary_message: `RAG retrieval found 0 matching items in the catalog for '${parsed.query}'.`,
      };
      return {
        query: parsed.query,
        retrievedCount: 0,
        candidates: [],
        selectedProduct: null,
        quoteLocked: null,
        policyResult: { passes: false, violations: ['No matching products found'], requiresHumanSignoff: true },
        explanation: 'No catalog candidates matched your search terms.',
        agentResponse: emptyTrace,
      };
    }

    // Step 2: Live Augmentation (Valio Aimo API Price & Stock)
    const productIds = rawCandidates.map((p) => p.id);
    const dateStr = parsed.deliver_by.slice(0, 10);
    const [prices, availability] = await Promise.all([
      this.catalog.fetchLivePrices(productIds, dateStr, customer),
      this.catalog.fetchLiveAvailability(productIds, dateStr, customer),
    ]);

    const candidateContexts: RAGProductContext[] = rawCandidates.map((prod) => {
      const priceInfo = prices.get(prod.id);
      const stockInfo = availability.get(prod.id);

      const catalogPrice = priceInfo?.catalogPrice ?? prod.base_price_eur ?? 12.5;
      const compPrice = priceInfo?.compPrice ?? Number((catalogPrice / Math.max(prod.pack_volume_litres, 1)).toFixed(2));
      const compUnit = priceInfo?.compUnit || 'L';
      const isAvailable = stockInfo?.isAvailable ?? true;
      const availablePacks = stockInfo?.availablePacks ?? 500;

      const packsNeeded = Math.max(1, Math.ceil(parsed.volume_litres / Math.max(prod.pack_volume_litres, 1)));
      const totalCost = Number((packsNeeded * catalogPrice).toFixed(2));

      const notes: string[] = [];
      let pass = true;

      if (!isAvailable || availablePacks < packsNeeded) {
        pass = false;
        notes.push(`Insufficient stock: need ${packsNeeded} packs, only ${availablePacks} available`);
      }

      if (totalCost > policy.max_auto_approve_eur) {
        notes.push(`Cost €${totalCost} exceeds auto-approval cap of €${policy.max_auto_approve_eur}`);
      }

      return {
        product: prod,
        catalogPriceEur: catalogPrice,
        comparisonPriceEur: compPrice,
        comparisonUnit: compUnit,
        isAvailable,
        availablePacks,
        packsRequired: packsNeeded,
        totalCostEur: totalCost,
        compliancePass: pass,
        complianceNotes: notes,
      };
    });

    traces.push({
      step_number: 2,
      title: 'RAG Step 2: Live Upstream Augmentation (Valio Aimo API)',
      description: `Augmented ${candidateContexts.length} candidates with live pricing (/api/price) and warehouse inventory (/api/availability) for requested delivery date ${dateStr}.`,
      action_type: 'tool_call',
      tool_name: 'valio_aimo_live_enrich',
      latency_ms: 22,
      tool_output: candidateContexts.map((c) => ({
        id: c.product.id,
        name: c.product.display_name,
        price_per_pack: `€${c.catalogPriceEur}`,
        comp_price: `€${c.comparisonPriceEur}/${c.comparisonUnit}`,
        in_stock_packs: c.availablePacks,
        packs_required: c.packsRequired,
        total_eur: `€${c.totalCostEur}`,
      })),
    });

    // Step 3: Synthesis & Selection using NVIDIA Nemotron 3.5 Super VL (DataCrunch B300)
    const nemotron = NemotronClient.getInstance();
    const nemotronDecision = await nemotron.reasonProcurement({
      prompt,
      candidates: candidateContexts,
      policy,
      requiredVolume: parsed.volume_litres,
    });

    let selected: RAGProductContext;
    let selectedPacks = 1;
    let selectedCost = 0;
    let aiExplanation = '';
    let chainOfThought: string | undefined = undefined;

    if (nemotronDecision) {
      const match = candidateContexts.find((c) => c.product.id === nemotronDecision.selectedSku);
      selected = match || candidateContexts[0];
      selectedPacks = nemotronDecision.packsToOrder || selected.packsRequired;
      selectedCost = nemotronDecision.totalCostEur || Number((selectedPacks * selected.catalogPriceEur).toFixed(2));
      aiExplanation = nemotronDecision.reasoning;
      chainOfThought = nemotronDecision.chainOfThought;
    } else {
      // Deterministic unit-economics fallback
      const availableCandidates = candidateContexts.filter((c) => c.isAvailable && c.availablePacks >= c.packsRequired);
      const pool = availableCandidates.length > 0 ? availableCandidates : candidateContexts;
      pool.sort((a, b) => a.comparisonPriceEur - b.comparisonPriceEur || a.totalCostEur - b.totalCostEur);
      selected = pool[0];
      selectedPacks = selected.packsRequired;
      selectedCost = selected.totalCostEur;
      aiExplanation = `Selected SKU ${selected.product.id} (${selected.product.display_name}) with lowest unit cost €${selected.comparisonPriceEur}/${selected.comparisonUnit}.`;
    }

    // Step 4: Policy & Guardrail Verification
    const mockQuote: QuoteLock = {
      quote_id: `quote_rag_${Date.now()}`,
      tenant_id: policy.tenant_id,
      sku: selected.product.id,
      pack_quantity: selectedPacks,
      locked_total_eur: selectedCost,
      total_litres: selectedPacks * selected.product.pack_volume_litres,
      deliver_by: parsed.deliver_by,
      status: 'LOCKED',
      expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
      created_at: new Date().toISOString(),
    };

    const mockProduct = {
      sku: selected.product.id,
      name: selected.product.display_name,
      category: selected.product.category,
      dietary_tags: selected.product.dietary_tags,
      pack_format: selected.product.pack_format,
      pack_volume_litres: selected.product.pack_volume_litres,
      min_lead_time_hours: 24,
      temperature_condition: selected.product.temperature_condition,
      is_active: selected.product.is_active,
      internal_cost_eur: selected.catalogPriceEur * 0.85,
      internal_margin_pct: 15,
      roadmap_status: 'LIVE' as const,
    };

    const policyEval = evaluateOrderPolicy({
      policy,
      product: mockProduct,
      quote: mockQuote,
      existingOrders,
    });

    traces.push({
      step_number: 3,
      title: nemotronDecision
        ? 'RAG Step 3: NVIDIA Nemotron-3.5-Super-VL Reasoning (DataCrunch B300)'
        : 'RAG Step 3: Synthesis & Policy Guardrail Evaluation',
      description: `${aiExplanation} Policy evaluation: ${policyEval.passes ? 'PASSED (Auto-Approve)' : `REQUIRES SIGN-OFF (${policyEval.violations.join('; ')})`}.`,
      action_type: 'reasoning',
      latency_ms: nemotronDecision?.latencyMs || 12,
      tool_output: {
        model: nemotronDecision?.model || 'deterministic-solver',
        selected_sku: selected.product.id,
        total_eur: selectedCost,
        unit_price: selected.comparisonPriceEur,
        policy_passes: policyEval.passes,
        violations: policyEval.violations,
        chain_of_thought: chainOfThought,
      },
    });

    const isAutoApproved = policyEval.passes;
    const finalStatus = isAutoApproved ? 'CONFIRMED' : 'PENDING_APPROVAL';

    const explanation = `${aiExplanation} ` +
      (isAutoApproved
        ? `Order (€${selectedCost.toFixed(2)}) is within the €${policy.max_auto_approve_eur} threshold and satisfies category rules. Order AUTO-APPROVED.`
        : `Order (€${selectedCost.toFixed(2)}) flagged for manager approval: ${policyEval.violations.join('. ')}.`);

    const agentResponse: AgentRunResponse = {
      success: true,
      mode_used: nemotronDecision ? 'nemotron-3.5-super-vl' : 'rag-augmented',
      execution_time_ms: Date.now() - t0,
      traces,
      final_status: finalStatus,
      summary_message: explanation,
      order: {
        order_id: `ord_${Date.now()}`,
        quote_id: mockQuote.quote_id,
        tenant_id: policy.tenant_id,
        po_reference: `PO-RAG-${Date.now().toString().slice(-6)}`,
        sku: selected.product.id,
        product_name: selected.product.display_name,
        category: selected.product.category,
        pack_quantity: selectedPacks,
        total_litres: selectedPacks * selected.product.pack_volume_litres,
        total_eur: selectedCost,
        status: isAutoApproved ? 'CONFIRMED' : 'PENDING_APPROVAL',
        approval_type: isAutoApproved ? 'AUTO' : 'PENDING',
        approved_by: isAutoApproved ? 'AimoGate Policy Engine (Auto)' : null,
        recurrent_grant_id: null,
        violation_reasons: isAutoApproved ? null : policyEval.violations,
        created_at: new Date().toISOString(),
        traces,
      },
    };

    return {
      query: parsed.query,
      retrievedCount: candidateContexts.length,
      candidates: candidateContexts,
      selectedProduct: selected,
      quoteLocked: mockQuote,
      policyResult: {
        passes: policyEval.passes,
        violations: policyEval.violations,
        requiresHumanSignoff: !policyEval.passes,
      },
      explanation,
      agentResponse,
    };
  }
}
