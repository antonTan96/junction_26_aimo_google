import fs from 'node:fs';
import path from 'node:path';
import { ValioAimoCatalogService, type CatalogProduct } from '../src/lib/valioAimoCatalog.ts';
import { ValioAimoRAGService } from '../src/lib/valioAimoRAG.ts';
import { parseBuyerPrompt, DEFAULT_TENANT_ID } from '../src/lib/aimogate.ts';
import type { TenantPolicy } from '../src/types/aimogate.ts';

export interface BenchmarkQueryGroundTruth {
  id: string;
  prompt: string;
  category: 'finnish' | 'english' | 'dietary' | 'pack_size' | 'brand' | 'multi_word';
  description: string;
  expectedCategory: string; // e.g. 'dairy', 'plant-based', 'bakery', 'beverages', 'cleaning'
  expectedKeywords: string[]; // At least one of these should appear in relevant products
  forbiddenKeywords?: string[]; // If present, indicates false-positive/hijacking
  requiredDietaryTags?: string[]; // e.g. ['lactose-free', 'vegan', 'gluten-free']
  expectedPackKeyword?: string; // e.g. '10l', '500g', '5l'
  expectedBrand?: string; // e.g. 'Valio', 'Paulig', 'Arla'
  primaryIntent: string; // The canonical item intended
}

export interface CandidateEvaluation {
  rank: number;
  id: string;
  name: string;
  brand: string;
  category: string;
  packFormat: string;
  packVolumeLitres: number;
  dietaryTags: string[];
  isRelevant: boolean;
  relevanceReason: string;
}

export interface QueryBenchmarkResult {
  queryId: string;
  prompt: string;
  category: string;
  description: string;
  extractedQuery: string;
  extractedAttributes: string[];
  candidateCount: number;
  candidates: CandidateEvaluation[];
  precisionAt1: number;
  precisionAt5: number;
  recallAt8: number;
  categoryMatchRate: number;
  selectedSku: string | null;
  selectedName: string | null;
  llmDecisionAccuracy: number;
  llmReasoning?: string;
  latencyMs: number;
  failureTypes: string[];
}

export interface BenchmarkSuiteSummary {
  target: 'live-rag' | 'live-catalog' | 'local';
  totalQueries: number;
  overallMetrics: {
    precisionAt1: number;
    precisionAt5: number;
    recallAt8: number;
    categoryMatchRate: number;
    llmDecisionAccuracy: number;
    queryFidelityRate: number;
  };
  byCategoryMetrics: Record<
    string,
    {
      count: number;
      precisionAt1: number;
      precisionAt5: number;
      recallAt8: number;
      categoryMatchRate: number;
      llmDecisionAccuracy: number;
    }
  >;
  failureCatalogue: Array<{
    queryId: string;
    prompt: string;
    extractedQuery: string;
    failureTypes: string[];
    topCandidate: string;
    selectedSku: string;
    diagnosis: string;
  }>;
}

export const BENCHMARK_TEST_SUITE: BenchmarkQueryGroundTruth[] = [
  // --- Group 1: Finnish Language Procurement Queries ---
  {
    id: 'FI-01',
    prompt: '50 litraa luomu täysmaitoa',
    category: 'finnish',
    description: 'Finnish partitive täysmaitoa (whole milk) + organic (luomu) 50L',
    expectedCategory: 'dairy',
    expectedKeywords: ['täysmaito', 'täysmaitoa', 'luomu', 'whole milk', 'organic'],
    forbiddenKeywords: ['croissant', 'suklaa', 'patukka'],
    requiredDietaryTags: ['organic'],
    primaryIntent: 'organic whole milk',
  },
  {
    id: 'FI-02',
    prompt: '10 kg meijerivoita',
    category: 'finnish',
    description: 'Finnish partitive meijerivoita (dairy butter) 10kg',
    expectedCategory: 'dairy',
    expectedKeywords: ['meijerivoi', 'meijerivoita', 'voi', 'butter'],
    forbiddenKeywords: ['croissant', 'leipä', 'veitsi'],
    primaryIntent: 'dairy butter',
  },
  {
    id: 'FI-03',
    prompt: 'laktoositon kevytmaito 200L',
    category: 'finnish',
    description: 'Finnish lactose-free semi-skimmed milk 200L',
    expectedCategory: 'dairy',
    expectedKeywords: ['kevytmaito', 'kevytmaitojuoma', 'laktoositon', 'semi skimmed'],
    forbiddenKeywords: ['kahvi', 'suklaa'],
    requiredDietaryTags: ['lactose-free'],
    primaryIntent: 'lactose-free semi-skimmed milk',
  },
  {
    id: 'FI-04',
    prompt: 'kuohukerma 5L',
    category: 'finnish',
    description: 'Finnish whipping cream 5L',
    expectedCategory: 'dairy',
    expectedKeywords: ['kuohukerma', 'kerma', 'whipping cream', 'cream'],
    forbiddenKeywords: ['voi', 'croissant'],
    primaryIntent: 'whipping cream',
  },
  {
    id: 'FI-05',
    prompt: 'kaurajuoma barista 10L',
    category: 'finnish',
    description: 'Finnish barista oat milk 10L',
    expectedCategory: 'plant-based',
    expectedKeywords: ['kaurajuoma', 'barista', 'kaura', 'oat', 'oddlygood'],
    forbiddenKeywords: ['lehmänmaito', 'täysmaito'],
    requiredDietaryTags: ['vegan'],
    primaryIntent: 'barista oat drink',
  },
  {
    id: 'FI-06',
    prompt: 'tuorejuusto 1kg leivontaan',
    category: 'finnish',
    description: 'Finnish cream cheese for baking 1kg',
    expectedCategory: 'dairy',
    expectedKeywords: ['tuorejuusto', 'cream cheese', 'juusto', 'maitorahka'],
    forbiddenKeywords: ['croissant'],
    primaryIntent: 'cream cheese',
  },

  // --- Group 2: English Language Queries ---
  {
    id: 'EN-01',
    prompt: '50 liters of organic whole milk',
    category: 'english',
    description: 'English organic whole milk 50L',
    expectedCategory: 'dairy',
    expectedKeywords: ['whole milk', 'täysmaito', 'luomu', 'organic'],
    forbiddenKeywords: ['skimmed', 'rasvaton', 'croissant'],
    requiredDietaryTags: ['organic'],
    primaryIntent: 'organic whole milk',
  },
  {
    id: 'EN-02',
    prompt: '10kg butter for the bakery',
    category: 'english',
    description: 'English butter with bakery context (tests keyword hijacking)',
    expectedCategory: 'dairy',
    expectedKeywords: ['butter', 'voi', 'meijerivoi'],
    forbiddenKeywords: ['croissant', 'bread', 'pastry'],
    primaryIntent: 'butter',
  },
  {
    id: 'EN-03',
    prompt: '100 units barista oat milk',
    category: 'english',
    description: 'English barista oat milk 100 units',
    expectedCategory: 'plant-based',
    expectedKeywords: ['barista', 'oat', 'kaura', 'oddlygood'],
    forbiddenKeywords: ['cow', 'lehmä'],
    requiredDietaryTags: ['vegan'],
    primaryIntent: 'barista oat drink',
  },
  {
    id: 'EN-04',
    prompt: 'fresh whipping cream 5L',
    category: 'english',
    description: 'English whipping cream 5L',
    expectedCategory: 'dairy',
    expectedKeywords: ['whipping cream', 'cream', 'kuohukerma', 'vispikerma'],
    forbiddenKeywords: ['butter', 'croissant'],
    primaryIntent: 'whipping cream',
  },
  {
    id: 'EN-05',
    prompt: 'parmesan cheese block 2kg',
    category: 'english',
    description: 'English parmesan cheese block 2kg',
    expectedCategory: 'dairy',
    expectedKeywords: ['parmesan', 'parmigiano', 'juusto', 'cheese', 'grana padano'],
    forbiddenKeywords: ['croissant', 'milk'],
    primaryIntent: 'parmesan cheese',
  },
  {
    id: 'EN-06',
    prompt: 'sour cream 5kg for hotel kitchen',
    category: 'english',
    description: 'English sour cream for hotel kitchen',
    expectedCategory: 'dairy',
    expectedKeywords: ['sour cream', 'kermaviili', 'smetana', 'hapankerma', 'creme fraiche'],
    forbiddenKeywords: ['croissant', 'butter'],
    primaryIntent: 'sour cream',
  },

  // --- Group 3: Dietary-Restricted Queries ---
  {
    id: 'DIET-01',
    prompt: 'lactose-free milk 30L',
    category: 'dietary',
    description: 'Dietary lactose-free milk 30L',
    expectedCategory: 'dairy',
    expectedKeywords: ['lactose free', 'laktoositon', 'milk', 'maito'],
    requiredDietaryTags: ['lactose-free'],
    forbiddenKeywords: ['croissant'],
    primaryIntent: 'lactose-free milk',
  },
  {
    id: 'DIET-02',
    prompt: 'vegan oat milk 20L',
    category: 'dietary',
    description: 'Dietary vegan oat drink 20L',
    expectedCategory: 'plant-based',
    expectedKeywords: ['vegan', 'oat', 'kaura', 'vegaani', 'oddlygood'],
    requiredDietaryTags: ['vegan'],
    forbiddenKeywords: ['lehmänmaito', 'dairy'],
    primaryIntent: 'vegan oat drink',
  },
  {
    id: 'DIET-03',
    prompt: 'gluten-free bread 15 packs',
    category: 'dietary',
    description: 'Dietary gluten-free bread 15 packs',
    expectedCategory: 'bakery',
    expectedKeywords: ['gluten-free', 'gluteeniton', 'leipä', 'bread'],
    requiredDietaryTags: ['gluten-free'],
    forbiddenKeywords: ['vehnäleipä'],
    primaryIntent: 'gluten-free bread',
  },
  {
    id: 'DIET-04',
    prompt: 'organic whole milk 20L',
    category: 'dietary',
    description: 'Dietary organic whole milk 20L',
    expectedCategory: 'dairy',
    expectedKeywords: ['organic', 'luomu', 'milk', 'maito', 'täysmaito'],
    requiredDietaryTags: ['organic'],
    forbiddenKeywords: ['non-organic'],
    primaryIntent: 'organic whole milk',
  },

  // --- Group 4: Pack-Size Specific Queries ---
  {
    id: 'PACK-01',
    prompt: 'Valio Eila semi skimmed milk 10 l novobox',
    category: 'pack_size',
    description: 'Bulk 10L novobox semi-skimmed milk',
    expectedCategory: 'dairy',
    expectedKeywords: ['novobox', '10 l', '10l', 'eila'],
    expectedPackKeyword: '10l',
    forbiddenKeywords: ['1l', '2,5 dl'],
    primaryIntent: '10L novobox milk',
  },
  {
    id: 'PACK-02',
    prompt: 'Valio meijerivoi 500g',
    category: 'pack_size',
    description: 'Retail 500g butter block',
    expectedCategory: 'dairy',
    expectedKeywords: ['meijerivoi', '500g', '500 g', 'butter'],
    expectedPackKeyword: '500g',
    forbiddenKeywords: ['10kg', 'croissant'],
    primaryIntent: '500g butter pack',
  },
  {
    id: 'PACK-03',
    prompt: 'Valio Pro Hygiene pintadesinfektio 5L',
    category: 'pack_size',
    description: 'Cleaning 5L disinfectant canister',
    expectedCategory: 'cleaning',
    expectedKeywords: ['hygiene', 'pintadesinfektio', 'sanitizer', '5l'],
    expectedPackKeyword: '5l',
    forbiddenKeywords: ['milk', 'dairy'],
    primaryIntent: '5L disinfectant sanitizer',
  },
  {
    id: 'PACK-04',
    prompt: 'Valio Oddlygood barista 1L carton',
    category: 'pack_size',
    description: 'Pack size 1L carton plant-based barista oat drink',
    expectedCategory: 'plant-based',
    expectedKeywords: ['oddlygood', 'barista', '1l', '1 l'],
    expectedPackKeyword: '1l',
    forbiddenKeywords: ['10l', 'cow'],
    primaryIntent: '1L barista oat drink',
  },

  // --- Group 5: Brand-Specific Queries ---
  {
    id: 'BRAND-01',
    prompt: 'Paulig espresso pavut 1kg',
    category: 'brand',
    description: 'Paulig brand professional espresso beans 1kg',
    expectedCategory: 'beverages',
    expectedKeywords: ['paulig', 'espresso', 'pavut', 'coffee', 'beans'],
    expectedBrand: 'Paulig',
    forbiddenKeywords: ['croissant', 'milk'],
    primaryIntent: 'Paulig espresso coffee beans',
  },
  {
    id: 'BRAND-02',
    prompt: 'Valio Oddlygood barista oat drink',
    category: 'brand',
    description: 'Valio Oddlygood brand barista oat drink',
    expectedCategory: 'plant-based',
    expectedKeywords: ['oddlygood', 'barista', 'oat', 'kaura'],
    expectedBrand: 'Valio Oddlygood',
    forbiddenKeywords: ['cow', 'dairy'],
    primaryIntent: 'Valio Oddlygood oat drink',
  },
  {
    id: 'BRAND-03',
    prompt: 'Valio Oltermanni kermajuusto 1kg',
    category: 'brand',
    description: 'Valio Oltermanni cream cheese 1kg',
    expectedCategory: 'dairy',
    expectedKeywords: ['oltermanni', 'kermajuusto', 'juusto', 'cheese'],
    expectedBrand: 'Valio',
    forbiddenKeywords: ['croissant'],
    primaryIntent: 'Valio Oltermanni cheese',
  },
  {
    id: 'BRAND-04',
    prompt: 'Arla laktoositon kevytmaito 10L',
    category: 'brand',
    description: 'Arla brand lactose-free milk 10L',
    expectedCategory: 'dairy',
    expectedKeywords: ['arla', 'kevytmaito', 'laktoositon', 'novobox'],
    expectedBrand: 'Arla',
    forbiddenKeywords: ['paulig'],
    primaryIntent: 'Arla lactose-free milk',
  },

  // --- Group 6: Multi-Word & Context-Heavy Queries ---
  {
    id: 'MULTI-01',
    prompt: 'We need 50 liters of organic whole milk and 10kg butter for the bakery',
    category: 'multi_word',
    description: 'Multi-item query with bakery keyword context',
    expectedCategory: 'dairy',
    expectedKeywords: ['milk', 'whole milk', 'butter', 'voi', 'maito', 'täysmaito'],
    forbiddenKeywords: ['croissant'],
    primaryIntent: 'milk or butter (not croissant)',
  },
  {
    id: 'MULTI-02',
    prompt: 'Urgent delivery of 20kg butter by Monday morning for hotel breakfast',
    category: 'multi_word',
    description: 'Context-heavy urgent delivery date + butter intent',
    expectedCategory: 'dairy',
    expectedKeywords: ['butter', 'voi', 'meijerivoi'],
    forbiddenKeywords: ['croissant', 'bread'],
    primaryIntent: 'butter',
  },
];

export class RAGBenchmarkHarness {
  private endpointUrl: string;
  private mode: 'live-rag' | 'live-catalog' | 'local';

  constructor(options?: { endpointUrl?: string; mode?: 'live-rag' | 'live-catalog' | 'local' | 'live' }) {
    this.endpointUrl =
      options?.endpointUrl ||
      process.env.AIMO_API_BASE ||
      'https://aimogate-api-625553130215.europe-north1.run.app';
    const rawMode = options?.mode || 'live-rag';
    this.mode = rawMode === 'live' ? 'live-rag' : (rawMode as 'live-rag' | 'live-catalog' | 'local');
  }

  /**
   * Evaluates relevance of a retrieved candidate against ground truth requirements
   */
  public evaluateCandidate(
    candidate: {
      id: string;
      display_name?: string;
      name_en?: string;
      name_fi?: string;
      category?: string;
      brand?: string;
      pack_format?: string;
      pack_volume_litres?: number;
      dietary_tags?: string[];
    },
    rank: number,
    gt: BenchmarkQueryGroundTruth
  ): CandidateEvaluation {
    const displayName = candidate.display_name || candidate.name_en || candidate.name_fi || '';
    const textCorpus = `${displayName} ${candidate.name_fi || ''} ${candidate.name_en || ''} ${candidate.brand || ''}`.toLowerCase();
    const cat = (candidate.category || '').toLowerCase();
    const tags = (candidate.dietary_tags || []).map((t) => t.toLowerCase());

    let isRelevant = true;
    const reasons: string[] = [];

    // 1. Category check
    if (gt.expectedCategory && cat !== gt.expectedCategory.toLowerCase()) {
      isRelevant = false;
      reasons.push(`Category mismatch: expected '${gt.expectedCategory}', got '${cat}'`);
    }

    // 2. Keyword match check
    const matchesExpectedKeyword = gt.expectedKeywords.some((kw) => textCorpus.includes(kw.toLowerCase()));
    if (!matchesExpectedKeyword) {
      isRelevant = false;
      reasons.push(`Missing expected keywords: none of [${gt.expectedKeywords.join(', ')}] found in '${displayName}'`);
    }

    // 3. Forbidden keywords (false-positives / hijacking)
    if (gt.forbiddenKeywords && gt.forbiddenKeywords.length > 0) {
      for (const fKw of gt.forbiddenKeywords) {
        if (textCorpus.includes(fKw.toLowerCase())) {
          isRelevant = false;
          reasons.push(`Matched forbidden keyword '${fKw}' (indicates false-positive/hijacking)`);
          break;
        }
      }
    }

    // 4. Required dietary tags
    if (gt.requiredDietaryTags && gt.requiredDietaryTags.length > 0) {
      for (const reqTag of gt.requiredDietaryTags) {
        const hasTag = tags.includes(reqTag.toLowerCase()) || textCorpus.includes(reqTag.toLowerCase());
        if (!hasTag) {
          isRelevant = false;
          reasons.push(`Missing required dietary tag '${reqTag}'`);
        }
      }
    }

    // 5. Pack keyword (if specified)
    if (gt.expectedPackKeyword) {
      const pkw = gt.expectedPackKeyword.toLowerCase();
      const hasPackMatch =
        textCorpus.includes(pkw) ||
        (candidate.pack_format || '').toLowerCase().includes(pkw) ||
        (candidate.pack_volume_litres && String(candidate.pack_volume_litres).includes(pkw));
      if (!hasPackMatch) {
        // Warning, soft penalty or failure
        reasons.push(`Pack size '${gt.expectedPackKeyword}' not explicitly matched`);
      }
    }

    // 6. Brand check (if specified)
    if (gt.expectedBrand) {
      const bLower = gt.expectedBrand.toLowerCase();
      const hasBrand = (candidate.brand || '').toLowerCase().includes(bLower) || textCorpus.includes(bLower);
      if (!hasBrand) {
        isRelevant = false;
        reasons.push(`Brand mismatch: expected '${gt.expectedBrand}', got '${candidate.brand}'`);
      }
    }

    return {
      rank,
      id: candidate.id,
      name: displayName,
      brand: candidate.brand || '',
      category: cat,
      packFormat: candidate.pack_format || '',
      packVolumeLitres: candidate.pack_volume_litres || 1,
      dietaryTags: tags,
      isRelevant,
      relevanceReason: isRelevant ? 'PASSED: Matches expected item and constraints' : reasons.join('; '),
    };
  }

  /**
   * Run benchmark query on live Cloud Run or local engine
   */
  public async runQuery(gt: BenchmarkQueryGroundTruth): Promise<QueryBenchmarkResult> {
    const t0 = Date.now();

    let extractedQuery = '';
    let extractedAttributes: string[] = [];
    let rawCandidates: any[] = [];
    let selectedSku: string | null = null;
    let selectedName: string | null = null;
    let llmReasoning: string | undefined = undefined;

    if (this.mode === 'live-catalog') {
      const parsed = parseBuyerPrompt(gt.prompt);
      extractedQuery = parsed.query;
      extractedAttributes = parsed.attributes;
      try {
        const url = new URL(`${this.endpointUrl.replace(/\/+$/, '')}/api/v1/catalog/search`);
        url.searchParams.set('q', parsed.query);
        url.searchParams.set('limit', '8');
        if (parsed.attributes.length > 0) {
          url.searchParams.set('tag', parsed.attributes[0]);
        }
        const res = await fetch(url.toString());
        if (!res.ok) {
          throw new Error(`Cloud Run catalog search HTTP ${res.status}: ${await res.text()}`);
        }
        const data = (await res.json()) as any;
        rawCandidates = data.products || [];
        selectedSku = rawCandidates[0]?.id || null;
        selectedName = rawCandidates[0]?.display_name || null;
        llmReasoning = 'Live Cloud Run catalog search ranking';
      } catch (err: any) {
        console.error(`[RAGBenchmark] Error running live catalog search for '${gt.prompt}':`, err.message);
        return this.runLocalQuery(gt);
      }
    } else if (this.mode === 'live-rag') {
      try {
        const res = await fetch(`${this.endpointUrl.replace(/\/+$/, '')}/api/v1/agent/run-rag`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: gt.prompt,
            tenant_id: DEFAULT_TENANT_ID,
            customer: '123',
          }),
        });

        if (!res.ok) {
          throw new Error(`Cloud Run HTTP ${res.status}: ${await res.text()}`);
        }

        const data = (await res.json()) as any;
        extractedQuery = data.query || '';
        rawCandidates = (data.candidates || []).map((c: any) => c.product || c);
        selectedSku = data.selectedProduct?.product?.id || null;
        selectedName = data.selectedProduct?.product?.display_name || null;
        llmReasoning = data.explanation || '';
      } catch (err: any) {
        console.error(`[RAGBenchmark] Error running live query '${gt.prompt}':`, err.message);
        // Fallback to local execution if live failed
        return this.runLocalQuery(gt);
      }
    } else {
      return this.runLocalQuery(gt);
    }

    const latencyMs = Date.now() - t0;

    // Evaluate candidates
    const candidateEvals: CandidateEvaluation[] = rawCandidates.slice(0, 8).map((c, i) =>
      this.evaluateCandidate(c, i + 1, gt)
    );

    const relevantCountTop5 = candidateEvals.slice(0, 5).filter((c) => c.isRelevant).length;
    const precisionAt1 = candidateEvals.length > 0 && candidateEvals[0].isRelevant ? 1 : 0;
    const precisionAt5 = candidateEvals.length > 0 ? Number((relevantCountTop5 / Math.min(5, candidateEvals.length)).toFixed(3)) : 0;
    const recallAt8 = candidateEvals.some((c) => c.isRelevant) ? 1 : 0;

    const catMatches = candidateEvals.filter((c) => c.category === gt.expectedCategory.toLowerCase()).length;
    const categoryMatchRate = candidateEvals.length > 0 ? Number((catMatches / candidateEvals.length).toFixed(3)) : 0;

    // Check LLM Decision Accuracy
    let llmDecisionAccuracy = 0;
    if (selectedSku) {
      const selectedCandidate = candidateEvals.find((c) => c.id === selectedSku);
      if (selectedCandidate) {
        llmDecisionAccuracy = selectedCandidate.isRelevant ? 1 : 0;
      } else {
        // Evaluate raw product
        const rawMatch = rawCandidates.find((c) => c.id === selectedSku);
        if (rawMatch) {
          const evalRes = this.evaluateCandidate(rawMatch, 0, gt);
          llmDecisionAccuracy = evalRes.isRelevant ? 1 : 0;
        }
      }
    }

    // Diagnose failure types
    const failureTypes: string[] = [];
    if (gt.prompt.toLowerCase().includes('bakery') && extractedQuery.toLowerCase().includes('croissant')) {
      failureTypes.push('KEYWORD_HIJACKING_BAKERY_TO_CROISSANT');
    }
    if (gt.prompt.toLowerCase().includes('butter') && !extractedQuery.toLowerCase().includes('butter') && !extractedQuery.toLowerCase().includes('voi')) {
      failureTypes.push('INTENT_OVERRIDDEN');
    }
    if (gt.category === 'finnish' && precisionAt1 === 0) {
      failureTypes.push('FINNISH_MORPHOLOGY_MISS');
    }
    if (categoryMatchRate < 0.5) {
      failureTypes.push('CATEGORY_DRIFT');
    }
    if (precisionAt1 === 0 && candidateEvals.length > 0) {
      failureTypes.push('TOP1_IRRELEVANT');
    }
    if (recallAt8 === 0) {
      failureTypes.push('TOTAL_RETRIEVAL_MISS');
    }
    if (llmDecisionAccuracy === 0) {
      failureTypes.push('LLM_SELECTION_MISMATCH');
    }

    return {
      queryId: gt.id,
      prompt: gt.prompt,
      category: gt.category,
      description: gt.description,
      extractedQuery,
      extractedAttributes,
      candidateCount: candidateEvals.length,
      candidates: candidateEvals,
      precisionAt1,
      precisionAt5,
      recallAt8,
      categoryMatchRate,
      selectedSku,
      selectedName,
      llmDecisionAccuracy,
      llmReasoning,
      latencyMs,
      failureTypes,
    };
  }

  private async runLocalQuery(gt: BenchmarkQueryGroundTruth): Promise<QueryBenchmarkResult> {
    const t0 = Date.now();
    const ragService = ValioAimoRAGService.getInstance();
    const mockPolicy: TenantPolicy = {
      tenant_id: DEFAULT_TENANT_ID,
      tenant_name: 'Benchmark Hotel Suite',
      max_auto_approve_eur: 5000,
      max_auto_approve_litres: 5000,
      allowed_categories: ['dairy', 'plant-based', 'bakery', 'beverages', 'cleaning'],
      anomaly_sensitivity_pct: 10,
      auto_dispute_enabled: true,
      category_rules: {
        dairy: { category: 'dairy', time_window: 'weekly', max_storage_litres: 2000, rule_valid_until: null },
      },
    };

    const res = await ragService.executeRAGPipeline({
      prompt: gt.prompt,
      policy: mockPolicy,
      existingOrders: [],
      customer: '123',
    });

    const parsed = parseBuyerPrompt(gt.prompt);
    const latencyMs = Date.now() - t0;

    const candidateEvals: CandidateEvaluation[] = res.candidates.slice(0, 8).map((c, i) =>
      this.evaluateCandidate(c.product, i + 1, gt)
    );

    const relevantCountTop5 = candidateEvals.slice(0, 5).filter((c) => c.isRelevant).length;
    const precisionAt1 = candidateEvals.length > 0 && candidateEvals[0].isRelevant ? 1 : 0;
    const precisionAt5 = candidateEvals.length > 0 ? Number((relevantCountTop5 / Math.min(5, candidateEvals.length)).toFixed(3)) : 0;
    const recallAt8 = candidateEvals.some((c) => c.isRelevant) ? 1 : 0;

    const catMatches = candidateEvals.filter((c) => c.category === gt.expectedCategory.toLowerCase()).length;
    const categoryMatchRate = candidateEvals.length > 0 ? Number((catMatches / candidateEvals.length).toFixed(3)) : 0;

    let llmDecisionAccuracy = 0;
    const selectedSku = res.selectedProduct?.product?.id || null;
    const selectedName = res.selectedProduct?.product?.display_name || null;
    if (selectedSku) {
      const match = candidateEvals.find((c) => c.id === selectedSku);
      llmDecisionAccuracy = match && match.isRelevant ? 1 : 0;
    }

    const failureTypes: string[] = [];
    if (gt.prompt.toLowerCase().includes('bakery') && res.query.toLowerCase().includes('croissant')) {
      failureTypes.push('KEYWORD_HIJACKING_BAKERY_TO_CROISSANT');
    }
    if (gt.category === 'finnish' && precisionAt1 === 0) {
      failureTypes.push('FINNISH_MORPHOLOGY_MISS');
    }
    if (categoryMatchRate < 0.5) {
      failureTypes.push('CATEGORY_DRIFT');
    }
    if (precisionAt1 === 0 && candidateEvals.length > 0) {
      failureTypes.push('TOP1_IRRELEVANT');
    }
    if (recallAt8 === 0) {
      failureTypes.push('TOTAL_RETRIEVAL_MISS');
    }
    if (llmDecisionAccuracy === 0) {
      failureTypes.push('LLM_SELECTION_MISMATCH');
    }

    return {
      queryId: gt.id,
      prompt: gt.prompt,
      category: gt.category,
      description: gt.description,
      extractedQuery: res.query,
      extractedAttributes: parsed.attributes,
      candidateCount: candidateEvals.length,
      candidates: candidateEvals,
      precisionAt1,
      precisionAt5,
      recallAt8,
      categoryMatchRate,
      selectedSku,
      selectedName,
      llmDecisionAccuracy,
      llmReasoning: res.explanation,
      latencyMs,
      failureTypes,
    };
  }

  /**
   * Run entire benchmark test suite
   */
  public async runFullSuite(): Promise<{
    results: QueryBenchmarkResult[];
    summary: BenchmarkSuiteSummary;
  }> {
    console.log(`\n======================================================================`);
    console.log(`🚀 RUNNING STANDARDIZED VALIO AIMO RAG BENCHMARK (${this.mode.toUpperCase()} TARGET)`);
    console.log(`Endpoint: ${this.mode !== 'local' ? this.endpointUrl : 'Local in-memory engine'}`);
    console.log(`Test cases: ${BENCHMARK_TEST_SUITE.length} queries across 6 core categories`);
    console.log(`======================================================================\n`);

    const results: QueryBenchmarkResult[] = [];

    for (let i = 0; i < BENCHMARK_TEST_SUITE.length; i++) {
      const test = BENCHMARK_TEST_SUITE[i];
      process.stdout.write(`[${i + 1}/${BENCHMARK_TEST_SUITE.length}] Running query ${test.id} ("${test.prompt}")... `);
      const res = await this.runQuery(test);
      results.push(res);
      const p1Icon = res.precisionAt1 === 1 ? '✅' : '❌';
      const r8Icon = res.recallAt8 === 1 ? '✅' : '❌';
      const llmIcon = res.llmDecisionAccuracy === 1 ? '✅' : '❌';
      console.log(`[P@1: ${p1Icon} | R@8: ${r8Icon} | LLM: ${llmIcon}] (Latency: ${res.latencyMs}ms)`);
      if (res.failureTypes.length > 0) {
        console.log(`     ⚠️  Failures detected: ${res.failureTypes.join(', ')}`);
        console.log(`     👉 Extracted: '${res.extractedQuery}', Top candidate: '${res.candidates[0]?.name || 'NONE'}'`);
      }
    }

    // Compute Aggregates
    const total = results.length;
    const avgP1 = results.reduce((acc, r) => acc + r.precisionAt1, 0) / total;
    const avgP5 = results.reduce((acc, r) => acc + r.precisionAt5, 0) / total;
    const avgR8 = results.reduce((acc, r) => acc + r.recallAt8, 0) / total;
    const avgCat = results.reduce((acc, r) => acc + r.categoryMatchRate, 0) / total;
    const avgLlm = results.reduce((acc, r) => acc + r.llmDecisionAccuracy, 0) / total;
    const hijackedCount = results.filter((r) => r.failureTypes.some((f) => f.includes('HIJACKING'))).length;
    const queryFidelity = (total - hijackedCount) / total;

    // By Category Breakdown
    const categories = ['finnish', 'english', 'dietary', 'pack_size', 'brand', 'multi_word'];
    const byCategoryMetrics: BenchmarkSuiteSummary['byCategoryMetrics'] = {};

    for (const cat of categories) {
      const subset = results.filter((r) => r.category === cat);
      if (subset.length === 0) continue;
      byCategoryMetrics[cat] = {
        count: subset.length,
        precisionAt1: Number((subset.reduce((acc, r) => acc + r.precisionAt1, 0) / subset.length).toFixed(3)),
        precisionAt5: Number((subset.reduce((acc, r) => acc + r.precisionAt5, 0) / subset.length).toFixed(3)),
        recallAt8: Number((subset.reduce((acc, r) => acc + r.recallAt8, 0) / subset.length).toFixed(3)),
        categoryMatchRate: Number((subset.reduce((acc, r) => acc + r.categoryMatchRate, 0) / subset.length).toFixed(3)),
        llmDecisionAccuracy: Number((subset.reduce((acc, r) => acc + r.llmDecisionAccuracy, 0) / subset.length).toFixed(3)),
      };
    }

    const failureCatalogue = results
      .filter((r) => r.failureTypes.length > 0)
      .map((r) => ({
        queryId: r.queryId,
        prompt: r.prompt,
        extractedQuery: r.extractedQuery,
        failureTypes: r.failureTypes,
        topCandidate: r.candidates[0]?.name || 'NONE',
        selectedSku: r.selectedSku || 'NONE',
        diagnosis: r.candidates[0]?.relevanceReason || 'Irrelevant item retrieved',
      }));

    const summary: BenchmarkSuiteSummary = {
      target: this.mode,
      totalQueries: total,
      overallMetrics: {
        precisionAt1: Number(avgP1.toFixed(3)),
        precisionAt5: Number(avgP5.toFixed(3)),
        recallAt8: Number(avgR8.toFixed(3)),
        categoryMatchRate: Number(avgCat.toFixed(3)),
        llmDecisionAccuracy: Number(avgLlm.toFixed(3)),
        queryFidelityRate: Number(queryFidelity.toFixed(3)),
      },
      byCategoryMetrics,
      failureCatalogue,
    };

    return { results, summary };
  }
}

// CLI Execution Entry Point
async function main() {
  const args = process.argv.slice(2);
  const modeArg = args.find((a) => a.startsWith('--target='));
  const mode = modeArg ? (modeArg.split('=')[1] as any) : 'live-catalog';
  const jsonArg = args.find((a) => a.startsWith('--json='));
  const jsonOut = jsonArg ? jsonArg.split('=')[1] : null;

  const harness = new RAGBenchmarkHarness({ mode });
  const { results, summary } = await harness.runFullSuite();

  console.log(`\n======================================================================`);
  console.log(`📊 BENCHMARK SUMMARY REPORT (${mode.toUpperCase()})`);
  console.log(`======================================================================`);
  console.log(`Total Queries Evaluated: ${summary.totalQueries}`);
  console.log(`Overall Precision@1:     ${(summary.overallMetrics.precisionAt1 * 100).toFixed(1)}%`);
  console.log(`Overall Precision@5:     ${(summary.overallMetrics.precisionAt5 * 100).toFixed(1)}%`);
  console.log(`Overall Recall@8:        ${(summary.overallMetrics.recallAt8 * 100).toFixed(1)}%`);
  console.log(`Category Match Rate:     ${(summary.overallMetrics.categoryMatchRate * 100).toFixed(1)}%`);
  console.log(`LLM Decision Accuracy:   ${(summary.overallMetrics.llmDecisionAccuracy * 100).toFixed(1)}%`);
  console.log(`Query Fidelity Rate:     ${(summary.overallMetrics.queryFidelityRate * 100).toFixed(1)}%`);
  console.log(`----------------------------------------------------------------------`);
  console.log(`Breakdown by Query Category:`);
  for (const [cat, m] of Object.entries(summary.byCategoryMetrics)) {
    console.log(
      ` - ${cat.padEnd(12)} (N=${m.count}): P@1=${(m.precisionAt1 * 100).toFixed(1)}% | P@5=${(m.precisionAt5 * 100).toFixed(1)}% | R@8=${(m.recallAt8 * 100).toFixed(1)}% | CatMatch=${(m.categoryMatchRate * 100).toFixed(1)}% | LLMAcc=${(m.llmDecisionAccuracy * 100).toFixed(1)}%`
    );
  }
  console.log(`----------------------------------------------------------------------`);
  console.log(`Identified Failure Cases (${summary.failureCatalogue.length} queries impacted):`);
  for (const fail of summary.failureCatalogue) {
    console.log(` ❌ [${fail.queryId}] "${fail.prompt}"`);
    console.log(`    Extracted: "${fail.extractedQuery}" | Top SKU: ${fail.topCandidate}`);
    console.log(`    Failures: ${fail.failureTypes.join(', ')}`);
  }
  console.log(`======================================================================\n`);

  if (jsonOut) {
    fs.writeFileSync(jsonOut, JSON.stringify({ summary, results }, null, 2), 'utf8');
    console.log(`Saved benchmark results to ${jsonOut}`);
  }
}

if (import.meta.url.endsWith(process.argv[1]) || process.argv[1]?.includes('benchmark_rag')) {
  main().catch((err) => {
    console.error('Benchmark fatal error:', err);
    process.exit(1);
  });
}
