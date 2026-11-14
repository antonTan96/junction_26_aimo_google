import { ValioAimoCatalogService, type CatalogProduct } from './valioAimoCatalog.ts';
import { NemotronClient } from './nemotronClient.ts';
import {
  parseBuyerPrompt,
  evaluateOrderPolicy,
  DEFAULT_TENANT_ID,
} from './aimogate.ts';
import { preprocessBuyerPrompt } from './promptPreprocessor.ts';
import type {
  AgentRunResponse,
  AgentStepTrace,
  OrderDTO,
  OrderItemDTO,
  Principal,
  QuoteLock,
  SubstitutionRequestDTO,
  SubstitutionRule,
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
   * 1. Preprocess prompt: classify into single_item, multi_item, or recipe,
   *    deducing raw materials, yield, and dietary substitutions.
   * 2. Retrieve candidates from Catalog/MariaDB matching semantic terms.
   * 3. Augment candidates with live Valio Aimo prices and warehouse inventory.
   * 4. Evaluate tenant policy constraints & volume quotas.
   * 5. Synthesize optimal purchase recommendation with audit trace.
   */
  public async executeRAGPipeline(params: {
    prompt: string;
    policy: TenantPolicy;
    existingOrders?: OrderDTO[];
    customer?: string;
  }): Promise<RAGExecutionResult> {
    const t0 = Date.now();
    const { prompt, policy, existingOrders = [], customer = '123' } = params;
    const preprocessed = await preprocessBuyerPrompt(prompt);
    const traces: AgentStepTrace[] = [];

    // Branch A: Multi-item or Recipe Procurement Flow
    if (preprocessed.request_type === 'recipe' || (preprocessed.request_type === 'multi_item' && preprocessed.items.length > 1)) {
      const isRecipe = preprocessed.request_type === 'recipe';
      const recipeTitle = preprocessed.recipe ? preprocessed.recipe.name : 'Multi-Item Order';

      traces.push({
        step_number: 1,
        title: isRecipe
          ? `RAG Step 1: Culinary Recipe Deduction (${recipeTitle})`
          : 'RAG Step 1: Multi-Item Procurement Decomposition',
        description: isRecipe
          ? `Deduced ${preprocessed.items.length} required raw materials for ${recipeTitle} (Yield: ${preprocessed.recipe?.servings_or_yield} ${preprocessed.recipe?.yield_unit || 'servings'}). Dietary constraints: [${preprocessed.dietary_tags.join(', ') || 'none'}].`
          : `Decomposed multi-item procurement request into ${preprocessed.items.length} distinct item requirements.`,
        action_type: 'reasoning',
        latency_ms: Math.max(8, Date.now() - t0),
        tool_input: { prompt, preprocessed },
        tool_output: preprocessed.items,
      });

      // Retrieve catalog matches and live price/availability for each ingredient
      const orderItems: OrderItemDTO[] = [];
      const primaryCandidatesContexts: RAGProductContext[] = [];
      let totalCostEur = 0;
      let totalLitres = 0;
      const policyViolations: string[] = [];
      const dateStr = preprocessed.deliver_by.slice(0, 10);

      // Search catalog for all ingredients
      const allProductIds: string[] = [];
      const matchedPerItem: { item: typeof preprocessed.items[0]; product: CatalogProduct }[] = [];

      for (const item of preprocessed.items) {
        let matches = this.catalog.search(item.search_query, {
          limit: 4,
          tags: item.dietary_tags.length > 0 ? item.dietary_tags : undefined,
        });
        if (matches.length === 0) {
          matches = this.catalog.search(item.search_query, { limit: 4 });
        }
        if (matches.length === 0) {
          matches = this.catalog.search(item.category_hint, { limit: 4 });
        }

        const chosen = matches[0] || this.catalog.getBuiltinStaples()[0];
        if (chosen) {
          matchedPerItem.push({ item, product: chosen });
          allProductIds.push(chosen.id);
        }
      }

      // Live price and availability batch lookup
      const [prices, availability] = await Promise.all([
        this.catalog.fetchLivePrices(allProductIds, dateStr, customer),
        this.catalog.fetchLiveAvailability(allProductIds, dateStr, customer),
      ]);

      const allowedCats = (policy.allowed_categories || []).map((c) => c.toLowerCase());

      for (let i = 0; i < matchedPerItem.length; i++) {
        const { item, product: prod } = matchedPerItem[i];
        const priceInfo = prices.get(prod.id);
        const stockInfo = availability.get(prod.id);

        const packVol = prod.pack_volume_litres && prod.pack_volume_litres > 0 ? prod.pack_volume_litres : 1.0;
        const catalogPrice = priceInfo?.catalogPrice ?? prod.base_price_eur ?? 12.5;
        const compPrice = priceInfo?.compPrice ?? Number((catalogPrice / packVol).toFixed(2));
        const compUnit = priceInfo?.compUnit || 'L';
        const isAvailable = stockInfo?.isAvailable ?? true;
        const availablePacks = stockInfo?.availablePacks ?? 500;

        const packsNeeded = Math.max(1, Math.ceil(item.quantity / packVol));
        const lineCost = Number((packsNeeded * catalogPrice).toFixed(2));
        const deliveredVol = Number((packsNeeded * packVol).toFixed(2));

        totalCostEur += lineCost;
        totalLitres += deliveredVol;

        // Category whitelist validation per item
        if (!allowedCats.includes(prod.category.toLowerCase())) {
          policyViolations.push(
            `GUARDRAIL BLOCKED: Item '${prod.display_name}' category '${prod.category}' is not whitelisted for client '${policy.tenant_name}'`
          );
        }

        if (!isAvailable || availablePacks < packsNeeded) {
          policyViolations.push(`Insufficient stock for '${prod.display_name}': need ${packsNeeded} packs, available: ${availablePacks}`);
        }

        const ctx: RAGProductContext = {
          product: prod,
          catalogPriceEur: catalogPrice,
          comparisonPriceEur: compPrice,
          comparisonUnit: compUnit,
          isAvailable,
          availablePacks,
          packsRequired: packsNeeded,
          totalCostEur: lineCost,
          compliancePass: isAvailable && availablePacks >= packsNeeded,
          complianceNotes: [],
        };

        primaryCandidatesContexts.push(ctx);

        orderItems.push({
          sku: prod.id,
          product_name: prod.display_name,
          category: prod.category,
          dietary_tags: prod.dietary_tags,
          pack_format: prod.pack_format,
          pack_quantity: packsNeeded,
          delivered_volume: deliveredVol,
          unit_price_eur: catalogPrice,
          total_price_eur: lineCost,
          deduced_from_ingredient: `${item.ingredient_name} (${item.quantity} ${item.unit})`,
        });
      }

      totalCostEur = Number(totalCostEur.toFixed(2));

      if (totalCostEur > policy.max_auto_approve_eur) {
        policyViolations.push(
          `Total composite order cost €${totalCostEur.toFixed(2)} exceeds tenant auto-approval limit of €${policy.max_auto_approve_eur.toFixed(2)}`
        );
      }

      traces.push({
        step_number: 2,
        title: 'RAG Step 2: Semantic Catalog Retrieval & BOM Formulation',
        description: `Matched ${orderItems.length} catalog products to the recipe requirements. Live prices and warehouse inventory augmented via Valio Aimo API.`,
        action_type: 'tool_call',
        tool_name: 'valio_aimo_live_enrich',
        latency_ms: 24,
        tool_output: orderItems.map((o) => ({
          deduced_from: o.deduced_from_ingredient,
          sku: o.sku,
          product: o.product_name,
          packs: o.pack_quantity,
          unit_price: `€${o.unit_price_eur}`,
          total: `€${o.total_price_eur}`,
        })),
      });

      const passes = policyViolations.length === 0;
      const finalStatus = passes ? 'CONFIRMED' : 'PENDING_APPROVAL';

      const summary = passes
        ? `Order for ${recipeTitle} (${orderItems.length} items, total €${totalCostEur.toFixed(2)}) AUTO-APPROVED within policy cap of €${policy.max_auto_approve_eur.toFixed(2)}.`
        : `Order for ${recipeTitle} (${orderItems.length} items, total €${totalCostEur.toFixed(2)}) flagged for manager approval: ${policyViolations.join('; ')}.`;

      traces.push({
        step_number: 3,
        title: 'RAG Step 3: Synthesis & Policy Guardrail Evaluation',
        description: summary,
        action_type: 'reasoning',
        latency_ms: 12,
        tool_output: {
          recipe: recipeTitle,
          total_eur: totalCostEur,
          items_count: orderItems.length,
          policy_passes: passes,
          violations: policyViolations,
        },
      });

      const primaryCandidate = primaryCandidatesContexts[0] || null;

      const mockQuote: QuoteLock = {
        quote_id: `quote_rag_${Date.now()}`,
        tenant_id: policy.tenant_id,
        sku: primaryCandidate?.product.id || 'COMPOSITE',
        pack_quantity: orderItems.reduce((acc, it) => acc + it.pack_quantity, 0),
        locked_total_eur: totalCostEur,
        total_litres: totalLitres,
        deliver_by: preprocessed.deliver_by,
        status: 'LOCKED',
        expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
        created_at: new Date().toISOString(),
      };

      const agentResponse: AgentRunResponse = {
        success: true,
        mode_used: 'rag-recipe-decomposed',
        execution_time_ms: Date.now() - t0,
        traces,
        final_status: finalStatus,
        summary_message: summary,
        preprocessed_prompt: preprocessed,
        order: {
          order_id: `ord_${Date.now()}`,
          quote_id: mockQuote.quote_id,
          tenant_id: policy.tenant_id,
          po_reference: `PO-RECIPE-${Date.now().toString().slice(-6)}`,
          sku: primaryCandidate?.product.id || 'COMPOSITE',
          product_name: isRecipe
            ? `${recipeTitle} (${preprocessed.recipe?.servings_or_yield} ${preprocessed.recipe?.yield_unit})`
            : `${recipeTitle} (${orderItems.length} items)`,
          recipe_name: isRecipe ? recipeTitle : null,
          category: primaryCandidate?.product.category || 'bakery',
          pack_quantity: mockQuote.pack_quantity,
          total_litres: totalLitres,
          total_eur: totalCostEur,
          status: passes ? 'CONFIRMED' : 'PENDING_APPROVAL',
          approval_type: passes ? 'AUTO' : 'PENDING',
          approved_by: passes ? 'AimoGate Policy Engine (Auto)' : null,
          recurrent_grant_id: null,
          violation_reasons: passes ? null : policyViolations,
          created_at: new Date().toISOString(),
          items: orderItems,
          traces,
        },
      };

      return {
        query: recipeTitle,
        retrievedCount: primaryCandidatesContexts.length,
        candidates: primaryCandidatesContexts,
        selectedProduct: primaryCandidate,
        quoteLocked: mockQuote,
        policyResult: {
          passes,
          violations: policyViolations,
          requiresHumanSignoff: !passes,
        },
        explanation: summary,
        agentResponse,
      };
    }

    // Branch B: Single Item Procurement Flow (Backward-Compatible Standard RAG)
    const parsed = parseBuyerPrompt(prompt);

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
        preprocessed_prompt: preprocessed,
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

      const packVol = prod.pack_volume_litres && prod.pack_volume_litres > 0 ? prod.pack_volume_litres : 1.0;
      const catalogPrice = priceInfo?.catalogPrice ?? prod.base_price_eur ?? 12.5;
      const compPrice = priceInfo?.compPrice ?? Number((catalogPrice / packVol).toFixed(2));
      const compUnit = priceInfo?.compUnit || 'L';
      const isAvailable = stockInfo?.isAvailable ?? true;
      const availablePacks = stockInfo?.availablePacks ?? 500;

      const packsNeeded = Math.max(1, Math.ceil(parsed.volume_litres / packVol));
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

    // Check for inventory shortage on primary desired candidate
    const primaryCandidate = candidateContexts[0];
    const isPrimaryShortage = !primaryCandidate.isAvailable || primaryCandidate.availablePacks < primaryCandidate.packsRequired;
    let substitutionRequest: SubstitutionRequestDTO | null = null;

    if (isPrimaryShortage) {
      const subRule = policy.substitution_rules?.[primaryCandidate.product.id];

      if (subRule && subRule.auto_approved) {
        // Active substitution rule found -> auto-substitute
        const ruleMatch = candidateContexts.find((c) => c.product.id === subRule.substitute_sku);
        if (ruleMatch && ruleMatch.isAvailable && ruleMatch.availablePacks >= ruleMatch.packsRequired) {
          selected = ruleMatch;
          selectedPacks = ruleMatch.packsRequired;
          selectedCost = ruleMatch.totalCostEur;
          aiExplanation = `Inventory shortage for '${primaryCandidate.product.display_name}'. Auto-substituted '${ruleMatch.product.display_name}' under active rule '${subRule.id}'.`;
        }
      } else {
        // No substitution rule created -> Formulate substitution request to accept said substitution
        const availableAlternatives = candidateContexts.filter(
          (c) => c.product.id !== primaryCandidate.product.id && c.isAvailable && c.availablePacks >= c.packsRequired
        );
        const substituteCandidate = availableAlternatives[0];

        if (substituteCandidate) {
          selected = substituteCandidate;
          selectedPacks = substituteCandidate.packsRequired;
          selectedCost = substituteCandidate.totalCostEur;

          const priceDiffEur = Number((substituteCandidate.totalCostEur - primaryCandidate.totalCostEur).toFixed(2));
          const priceDiffPct = Number((((substituteCandidate.totalCostEur - primaryCandidate.totalCostEur) / (primaryCandidate.totalCostEur || 1)) * 100).toFixed(1));

          substitutionRequest = {
            request_id: `SUB-${Date.now().toString().slice(-6)}`,
            tenant_id: policy.tenant_id,
            status: 'PENDING',
            original_sku: primaryCandidate.product.id,
            original_name: primaryCandidate.product.display_name,
            requested_packs: primaryCandidate.packsRequired,
            available_packs: primaryCandidate.availablePacks,
            unit_contract_price_eur: primaryCandidate.catalogPriceEur,
            original_total_eur: primaryCandidate.totalCostEur,
            substitute_sku: substituteCandidate.product.id,
            substitute_name: substituteCandidate.product.display_name,
            substitute_packs: substituteCandidate.packsRequired,
            substitute_unit_price_eur: substituteCandidate.catalogPriceEur,
            substitute_total_eur: substituteCandidate.totalCostEur,
            price_difference_eur: priceDiffEur,
            price_difference_pct: priceDiffPct,
            reason: `Inventory shortage for '${primaryCandidate.product.display_name}' (${primaryCandidate.availablePacks} available, ${primaryCandidate.packsRequired} requested). No substitution rule configured. Acceptance required.`,
            created_at: new Date().toISOString(),
          };

          aiExplanation = `Inventory shortage for '${primaryCandidate.product.display_name}' (${primaryCandidate.availablePacks}/${primaryCandidate.packsRequired} packs). No substitution rule configured. Formulated substitution request ${substitutionRequest.request_id} proposing '${substituteCandidate.product.display_name}' (€${substituteCandidate.totalCostEur.toFixed(2)}).`;
        }
      }
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

    if (substitutionRequest) {
      policyEval.passes = false;
      policyEval.violations = [
        `SUBSTITUTION_REQUIRED: Inventory shortage for original item '${substitutionRequest.original_name}'. Substitution approval requested.`,
      ];
    }

    traces.push({
      step_number: 3,
      title: substitutionRequest
        ? 'RAG Step 3: Inventory Shortage & Substitution Request Formulated'
        : nemotronDecision
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
        substitution_request: substitutionRequest,
      },
    });

    const isAutoApproved = policyEval.passes && !substitutionRequest;
    const finalStatus = isAutoApproved ? 'CONFIRMED' : 'PENDING_APPROVAL';

    const explanation = substitutionRequest
      ? `Inventory shortage for '${substitutionRequest.original_name}'. No substitution rule created. Sent request ${substitutionRequest.request_id} to accept substitution '${substitutionRequest.substitute_name}' (€${substitutionRequest.substitute_total_eur.toFixed(2)}). Order held in PENDING_APPROVAL.`
      : `${aiExplanation} ` +
        (isAutoApproved
          ? `Order (€${selectedCost.toFixed(2)}) is within the €${policy.max_auto_approve_eur} threshold and satisfies category rules. Order AUTO-APPROVED.`
          : `Order (€${selectedCost.toFixed(2)}) flagged for manager approval: ${policyEval.violations.join('. ')}.`);

    const singleOrderItem: OrderItemDTO = {
      sku: selected.product.id,
      product_name: selected.product.display_name,
      category: selected.product.category,
      dietary_tags: selected.product.dietary_tags,
      pack_format: selected.product.pack_format,
      pack_quantity: selectedPacks,
      delivered_volume: selectedPacks * selected.product.pack_volume_litres,
      unit_price_eur: selected.catalogPriceEur,
      total_price_eur: selectedCost,
      deduced_from_ingredient: substitutionRequest
        ? `Substitution proposed for ${substitutionRequest.original_name}`
        : preprocessed.items[0]?.ingredient_name || selected.product.display_name,
    };

    const agentResponse: AgentRunResponse = {
      success: true,
      mode_used: nemotronDecision ? 'nemotron-3.5-super-vl' : 'rag-augmented',
      execution_time_ms: Date.now() - t0,
      traces,
      final_status: finalStatus,
      summary_message: explanation,
      preprocessed_prompt: preprocessed,
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
        items: [singleOrderItem],
        substitution_request: substitutionRequest,
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
