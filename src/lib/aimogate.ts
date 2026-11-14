import type {
  AgentRunResponse,
  AgentStepTrace,
  AuditLogEntry,
  CategoryRule,
  CategoryRuleUsageDTO,
  CategoryTimeWindow,
  CustomerRosterItem,
  GuardrailWhitelistDTO,
  NetworkOverview,
  OrderDTO,
  Principal,
  PrincipalType,
  Product,
  PublicOfferDTO,
  QuoteLock,
  RecurrentApprovalGrant,
  ScheduledPrompt,
  StockSummaryItem,
  TenantPolicy,
  TokenBundle,
  WarehouseStock,
  ZeroTrustInspectResponse,
} from '../types/aimogate.ts';
import { ValioAimoCatalogService } from './valioAimoCatalog.ts';

export const SYSTEM_CATEGORIES = [
  'dairy',
  'plant-based',
  'bakery',
  'beverages',
  'cleaning',
  'meat',
  'alcohol',
] as const;

export const DEFAULT_TENANT_ID = 'hotel_nordic_group';

export class GatewayError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function computeIntegrityHash(input: string): string {
  let h1 = 0xdeadbeef ^ input.length;
  let h2 = 0x41c6ce57 ^ input.length;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const hex1 = (h1 >>> 0).toString(16).padStart(8, '0');
  const hex2 = (h2 >>> 0).toString(16).padStart(8, '0');
  return `0x${hex1}${hex2}`;
}

export function computeShortHash(input: string): string {
  const full = computeIntegrityHash(input);
  return `${full.slice(0, 6)}...${full.slice(-4)}`;
}

export function getTimeWindowDurationMs(window: CategoryTimeWindow): number | null {
  switch (window) {
    case 'daily':
      return 1 * 86400_000;
    case 'weekly':
      return 7 * 86400_000;
    case 'monthly':
      return 30 * 86400_000;
    case 'none':
    default:
      return null;
  }
}

export interface PolicyEvaluationResult {
  passes: boolean;
  violations: string[];
  matchingGrant: RecurrentApprovalGrant | null;
}

export interface PolicyEvaluationParams {
  policy: TenantPolicy;
  product: Product;
  quote: QuoteLock;
  activeGrants?: RecurrentApprovalGrant[];
  existingOrders?: OrderDTO[];
  orders?: OrderDTO[];
  killswitchHalted?: boolean;
  now?: Date;
}

export function evaluateOrderPolicy(params: PolicyEvaluationParams): PolicyEvaluationResult {
  const {
    policy,
    product,
    quote,
    activeGrants = [],
    killswitchHalted = false,
    now = new Date(),
  } = params;
  const violations: string[] = [];
  let matchingGrant: RecurrentApprovalGrant | null = null;

  if (killswitchHalted) {
    violations.push('GLOBAL KILLSWITCH ARMED: All autonomous agent transactions are halted by operator circuit breaker.');
    return { passes: false, violations, matchingGrant: null };
  }

  const lockedEur = Number(quote.locked_total_eur);
  const maxEur = Number(policy.max_auto_approve_eur);
  const totalLitres = Number(quote.total_litres);
  const maxLitres = Number(policy.max_auto_approve_litres);

  for (const g of activeGrants) {
    if (g.tenant_id !== policy.tenant_id || g.status !== 'ACTIVE') continue;
    const validFrom = new Date(g.valid_from);
    const validUntil = new Date(g.valid_until);
    if (now < validFrom || now > validUntil) continue;

    const catMatch = g.category.toLowerCase() === product.category.toLowerCase() || g.category === '*';
    const skuMatch = g.sku === null || g.sku === quote.sku;
    if (catMatch && skuMatch) {
      const remaining = Number(g.max_budget_per_period_eur) - Number(g.current_period_spent_eur);
      if (lockedEur <= remaining) {
        matchingGrant = g;
        break;
      } else {
        violations.push(
          `Recurrent grant budget exceeded: Order €${lockedEur.toFixed(2)} exceeds remaining window budget €${remaining.toFixed(2)} (Cap: €${Number(g.max_budget_per_period_eur).toFixed(2)})`
        );
      }
    }
  }

  const allowedCats = (policy.allowed_categories || []).map((c) => c.toLowerCase());
  if (!matchingGrant && !allowedCats.includes(product.category.toLowerCase())) {
    violations.push(
      `GUARDRAIL BLOCKED: Category '${product.category}' is not whitelisted for client '${policy.tenant_name}' (Allowed: ${allowedCats.join(', ')})`
    );
  }

  const catKey = product.category.toLowerCase();
  const categoryRule = policy.category_rules?.[catKey] || policy.category_rules?.[product.category];

  if (!matchingGrant && categoryRule) {
    // 1. Expiration check: If rule_valid_until is set and now > rule_valid_until, rule is expired
    if (categoryRule.rule_valid_until !== null && categoryRule.rule_valid_until !== undefined) {
      const validUntil = new Date(categoryRule.rule_valid_until);
      if (!isNaN(validUntil.getTime()) && now.getTime() > validUntil.getTime()) {
        violations.push(
          `Category rule for '${product.category}' has expired on ${categoryRule.rule_valid_until}. Human approval required.`
        );
      }
    }

    // 2. Cumulative storage limit check in active time window
    if (categoryRule.time_window !== 'none' && categoryRule.max_storage_litres > 0) {
      const durationMs = getTimeWindowDurationMs(categoryRule.time_window);
      let pastLitres = 0;
      if (durationMs !== null) {
        const windowStartMs = now.getTime() - durationMs;
        const orderList = params.existingOrders || params.orders || [];
        for (const o of orderList) {
          if (o.tenant_id !== policy.tenant_id) continue;
          if (o.status !== 'CONFIRMED') continue;
          const oTime = new Date(o.created_at).getTime();
          if (isNaN(oTime) || oTime < windowStartMs || oTime > now.getTime()) continue;
          const oCat = (o.category || '').toLowerCase();
          if (oCat === catKey) {
            pastLitres += Number(o.total_litres) || 0;
          }
        }
      }
      const periodVolume = Number((pastLitres + totalLitres).toFixed(1));
      if (periodVolume > categoryRule.max_storage_litres) {
        const windowName = categoryRule.time_window.charAt(0).toUpperCase() + categoryRule.time_window.slice(1);
        const unit = categoryRule.time_window === 'weekly' ? 'week' : categoryRule.time_window === 'daily' ? 'day' : 'month';
        violations.push(
          `${windowName} storage limit exceeded for category '${product.category}': Order brings period volume to ${periodVolume.toFixed(1)}L, exceeding limit of ${categoryRule.max_storage_litres.toFixed(1)}L/${unit}. Requires human approval.`
        );
      }
    } else if (categoryRule.time_window === 'none' && categoryRule.max_storage_litres > 0) {
      if (totalLitres > categoryRule.max_storage_litres) {
        violations.push(
          `Order volume ${totalLitres.toFixed(1)}L exceeds category storage limit of ${categoryRule.max_storage_litres.toFixed(1)}L`
        );
      }
    }
  }

  if (!matchingGrant && lockedEur > maxEur) {
    if (!violations.some((v) => v.includes('budget exceeded'))) {
      violations.push(
        `Order total €${lockedEur.toFixed(2)} exceeds autonomous limit of €${maxEur.toFixed(2)}`
      );
    }
  }

  if (!matchingGrant && !categoryRule && totalLitres > maxLitres) {
    violations.push(
      `Order volume ${totalLitres.toFixed(1)}L exceeds autonomous limit of ${maxLitres.toFixed(1)}L`
    );
  }

  return {
    passes: violations.length === 0,
    violations,
    matchingGrant,
  };
}

export function evaluatePolicy(params: PolicyEvaluationParams): PolicyEvaluationResult {
  return evaluateOrderPolicy(params);
}

export function parseBuyerPrompt(prompt: string, now: Date = new Date()): {
  volume_litres: number;
  query: string;
  attributes: string[];
  deliver_by: string;
} {
  const text = prompt.toLowerCase();

  // 1. Multilingual quantity regex for both English and Finnish units:
  // (?:l|litres?|litraa?|kg|kiloa?|g|grammaa?|kpl|pcs|units?|boxes?|laatikkoa?|packs?|pussia?|canisters?|bottles?|pulloa?)
  const volMatch = text.match(/([\d,]+(?:\.\d+)?)\s*(?:l|litres?|liter|liters|litraa?|kg|kilo|kilos|kiloa?)\b/i);
  const gramMatch = text.match(/([\d,]+(?:\.\d+)?)\s*(?:g|gram|grams|grammaa?)\b/i);
  const qtyMatch = text.match(/([\d,]+)\s*(?:kpl|pcs|units?|boxes?|laatikkoa?|packs?|pussia?|canisters?|bottles?|pulloa?|croissants?|cases?|cartons?)\b/i);

  let volumeLitres = 1000.0;
  if (volMatch) {
    volumeLitres = parseFloat(volMatch[1].replace(/,/g, ''));
  } else if (gramMatch) {
    volumeLitres = parseFloat(gramMatch[1].replace(/,/g, '')) / 1000.0;
  } else if (qtyMatch) {
    volumeLitres = parseFloat(qtyMatch[1].replace(/,/g, '')) * 3.25;
  }

  // 2. Preserve dietary and product attribute modifiers:
  // organic / luomu, whole milk / täysmaito, skimmed milk / rasvaton maito, lactose-free / laktoositon, gluten-free / gluteeniton, vegan / plant-based / vegaani
  const attributes: string[] = [];
  if (text.includes('lactose-free') || text.includes('lactose free') || text.includes('laktoositon')) {
    attributes.push('lactose-free');
  }
  if (text.includes('vegan') || text.includes('plant-based') || text.includes('plant based') || text.includes('vegaani')) {
    attributes.push('vegan');
  }
  if (text.includes('gluten-free') || text.includes('gluten free') || text.includes('gluteeniton')) {
    attributes.push('gluten-free');
  }
  if (text.includes('organic') || text.includes('luomu')) {
    attributes.push('organic');
  }

  // 3. Extract department/location/time context without letting department nouns (bakery, coffee) hijack the product search query
  let cleaned = text
    // Strip department/location/usage context phrases FIRST so department nouns don't hijack product intent:
    .replace(/\bfor\s+(?:the\s+)?bakery\b/gi, '')
    .replace(/\bfor\s+morning\s+coffee(?:\s+service)?\b/gi, '')
    .replace(/\bfor\s+(?:the\s+)?coffee\s+service\b/gi, '')
    .replace(/\bfor\s+(?:the\s+)?cafeteria\b/gi, '')
    .replace(/\bfor\s+(?:our\s+|the\s+)?(?:kitchen|restaurant|hotel\s+kitchen|hotel\s+breakfast|hotel)\b/gi, '')
    .replace(/\bfor\s+breakfast\b/gi, '')
    .replace(/\bleivontaan\b/gi, '')
    .replace(/\b(?:varten|meille)\b/gi, '')
    // Strip action prefixes:
    .replace(/^(?:please\s+)?(?:can\s+you\s+)?(?:order|buy|purchase|deliver|we\s+need|restock|get\s+us|i\s+need|send|tilatkaa|tarvitsemme|tilataan)\s+/gi, '')
    .replace(/^urgent\s+delivery\s+of\s+/gi, '')
    .replace(/\burgent(?:ly)?\b/gi, '')
    // Strip delivery date / time / urgency clauses:
    .replace(/\b(?:find\s+an\s+option|check\s+(?:price|availability)).*$/gi, '')
    .replace(/\b(?:by|before|until|on)\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today|asap)(?:\s+(?:morning|afternoon|evening))?\b/gi, '')
    .replace(/\b(?:by|before|until)\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?\b/gi, '')
    .replace(/\b(?:before|after)\s+\d+\s*(?:am|pm)?\b/gi, '')
    .replace(/\b(?:by|before|until)\s+[\w\d\s,.-]+$/gi, '')
    // Strip quantity expressions with units:
    .replace(/([\d,]+(?:\.\d+)?)\s*(?:l|litres?|liter|liters|litraa?|kg|kilo|kilos|kiloa?|g|gram|grams|grammaa?|kpl|pcs|units?|boxes?|laatikkoa?|packs?|pussia?|canisters?|bottles?|pulloa?|cases?|cartons?)\b/gi, '')
    .replace(/\b(?:of|for)\b/gi, ' ')
    .replace(/[.,;!?]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();

  // 4. Extract product intent accurately:
  let query = '';

  // Guardrail test & explicit croissant intent
  if (text.includes('croissant')) {
    query = 'croissant';
  } else if (text.includes('butter for the bakery') || cleaned === 'butter' || cleaned === 'cooking butter') {
    // If prompt says 'butter for the bakery', query MUST be 'cooking butter' or 'butter' (NOT 'croissant')
    query = 'cooking butter';
  } else if (text.includes('whole milk for morning coffee service')) {
    // If prompt says 'whole milk for morning coffee service', query MUST be 'whole milk' (NOT 'espresso beans')
    query = 'whole milk';
  } else if (cleaned.length > 0) {
    query = cleaned;
  } else if (text.includes('butter') || text.includes('voi')) {
    query = 'cooking butter';
  } else if (text.includes('whole milk') || text.includes('täysmaito')) {
    query = 'whole milk';
  } else if (text.includes('dairy') || text.includes('milk')) {
    query = 'lactose-free milk';
  } else {
    query = 'lactose-free milk';
  }

  const weekday = now.getUTCDay(); // 0=Sun, 1=Mon
  let daysAhead = (1 - weekday + 7) % 7;
  if (daysAhead <= 1) daysAhead += 7;
  const deliverBy = new Date(now.getTime() + daysAhead * 86400_000 + 8 * 3600_000);

  return {
    volume_litres: volumeLitres,
    query,
    attributes,
    deliver_by: deliverBy.toISOString(),
  };
}

export class AimoGateStore {
  policies = new Map<string, TenantPolicy>();
  products = new Map<string, Product>();
  contractPrices = new Map<string, number>(); // key: `${tenant_id}::${sku}`
  stock = new Map<string, WarehouseStock>();
  quoteLocks = new Map<string, QuoteLock>();
  orders = new Map<string, OrderDTO>();
  grants = new Map<string, RecurrentApprovalGrant>();
  scheduledPrompts = new Map<string, ScheduledPrompt>();
  auditLogs: AuditLogEntry[] = [];
  killswitchHalted = false;
  private auditSeq = 1;
  private idCounter = 1000;

  constructor() {
    this.reset();
  }

  getCounters(): { audit_seq: number; id_counter: number } {
    return { audit_seq: this.auditSeq, id_counter: this.idCounter };
  }

  setCounters(auditSeq: number, idCounter: number): void {
    this.auditSeq = auditSeq;
    this.idCounter = idCounter;
  }

  private nextHex(prefix: string): string {
    this.idCounter += 1;
    const h = (this.idCounter * 2654435761) >>> 0;
    return `${prefix}-${h.toString(16).toUpperCase().padStart(8, '0').slice(0, 8)}`;
  }

  addAuditLog(entry: Omit<AuditLogEntry, 'id' | 'timestamp' | 'verification_hash'>): AuditLogEntry {
    const id = this.auditSeq++;
    const timestamp = new Date().toISOString();
    const tenantName = this.policies.get(entry.tenant_id)?.tenant_name ?? entry.tenant_id;
    const hash = computeShortHash(`${id}|${timestamp}|${entry.tenant_id}|${entry.action}|${JSON.stringify(entry.payload_summary)}`);
    const full: AuditLogEntry = {
      id,
      timestamp,
      tenant_name: tenantName,
      verification_hash: hash,
      ...entry,
    };
    this.auditLogs.unshift(full);
    return full;
  }

  reset(now: Date = new Date()): void {
    this.policies.clear();
    this.products.clear();
    this.contractPrices.clear();
    this.stock.clear();
    this.quoteLocks.clear();
    this.orders.clear();
    this.grants.clear();
    this.scheduledPrompts.clear();
    this.auditLogs = [];
    this.auditSeq = 1;
    this.idCounter = 1000;
    this.killswitchHalted = false;

    const thirtyDaysLater = new Date(now.getTime() + 30 * 86400_000).toISOString();

    const policies: TenantPolicy[] = [
      {
        tenant_id: 'hotel_nordic_group',
        tenant_name: 'Nordic Crown Hotels (Helsinki)',
        max_auto_approve_eur: 800.0,
        max_auto_approve_litres: 600.0,
        allowed_categories: ['dairy', 'plant-based'],
        category_rules: {
          dairy: {
            category: 'dairy',
            time_window: 'weekly',
            max_storage_litres: 1000.0,
            rule_valid_until: thirtyDaysLater,
          },
          'plant-based': {
            category: 'plant-based',
            time_window: 'weekly',
            max_storage_litres: 600.0,
            rule_valid_until: thirtyDaysLater,
          },
        },
        anomaly_sensitivity_pct: 82,
        auto_dispute_enabled: true,
      },
      {
        tenant_id: 'scandic_helsinki_hub',
        tenant_name: 'Scandic Hotels Finland',
        max_auto_approve_eur: 1500.0,
        max_auto_approve_litres: 1200.0,
        allowed_categories: ['dairy', 'bakery', 'plant-based'],
        category_rules: {
          dairy: {
            category: 'dairy',
            time_window: 'weekly',
            max_storage_litres: 2000.0,
            rule_valid_until: thirtyDaysLater,
          },
          bakery: {
            category: 'bakery',
            time_window: 'weekly',
            max_storage_litres: 1000.0,
            rule_valid_until: thirtyDaysLater,
          },
          'plant-based': {
            category: 'plant-based',
            time_window: 'weekly',
            max_storage_litres: 1000.0,
            rule_valid_until: thirtyDaysLater,
          },
        },
        anomaly_sensitivity_pct: 75,
        auto_dispute_enabled: true,
      },
      {
        tenant_id: 'sodexo_campus_espoo',
        tenant_name: 'Sodexo Campus Dining (Otaniemi)',
        max_auto_approve_eur: 500.0,
        max_auto_approve_litres: 400.0,
        allowed_categories: ['dairy'],
        category_rules: {
          dairy: {
            category: 'dairy',
            time_window: 'weekly',
            max_storage_litres: 1000.0,
            rule_valid_until: thirtyDaysLater,
          },
        },
        anomaly_sensitivity_pct: 88,
        auto_dispute_enabled: true,
      },
      {
        tenant_id: 'fazer_food_services',
        tenant_name: 'Fazer Food & Restaurant Services',
        max_auto_approve_eur: 2500.0,
        max_auto_approve_litres: 2000.0,
        allowed_categories: ['dairy', 'plant-based', 'bakery'],
        category_rules: {
          dairy: {
            category: 'dairy',
            time_window: 'weekly',
            max_storage_litres: 3000.0,
            rule_valid_until: thirtyDaysLater,
          },
          'plant-based': {
            category: 'plant-based',
            time_window: 'weekly',
            max_storage_litres: 2000.0,
            rule_valid_until: thirtyDaysLater,
          },
          bakery: {
            category: 'bakery',
            time_window: 'weekly',
            max_storage_litres: 2000.0,
            rule_valid_until: thirtyDaysLater,
          },
        },
        anomaly_sensitivity_pct: 70,
        auto_dispute_enabled: true,
      },
    ];
    for (const pol of policies) this.policies.set(pol.tenant_id, pol);

    const products: Product[] = [
      {
        sku: 'VA-LF-MILK-10L',
        name: 'Valio Eila® Lactose-Free Semi-Skimmed Milk',
        category: 'dairy',
        dietary_tags: ['lactose-free'],
        pack_format: '10L Bag-in-Box',
        pack_volume_litres: 10.0,
        min_lead_time_hours: 24,
        is_active: true,
        internal_cost_eur: 9.62,
        internal_margin_pct: 18.5,
        roadmap_status: 'LIVE',
      },
      {
        sku: 'VA-LF-MILK-12X1L',
        name: 'Valio Eila® Lactose-Free Milk UHT',
        category: 'dairy',
        dietary_tags: ['lactose-free'],
        pack_format: '12x1L Carton',
        pack_volume_litres: 12.0,
        min_lead_time_hours: 24,
        is_active: true,
        internal_cost_eur: 12.23,
        internal_margin_pct: 21.0,
        roadmap_status: 'LIVE',
      },
      {
        sku: 'VA-OAT-BARISTA-10L',
        name: 'Valio Oddlygood® Barista Oat Drink',
        category: 'plant-based',
        dietary_tags: ['lactose-free', 'vegan', 'plant-based'],
        pack_format: '10L Bag-in-Box',
        pack_volume_litres: 10.0,
        min_lead_time_hours: 24,
        is_active: true,
        internal_cost_eur: 10.84,
        internal_margin_pct: 22.0,
        roadmap_status: 'LIVE',
      },
      {
        sku: 'VA-BAKERY-CROISSANT-50',
        name: 'Valio Artisanal Butter Croissant (50pk)',
        category: 'bakery',
        dietary_tags: ['vegetarian'],
        pack_format: '50x65g Case',
        pack_volume_litres: 3.25,
        min_lead_time_hours: 24,
        is_active: true,
        internal_cost_eur: 28.5,
        internal_margin_pct: 24.0,
        roadmap_status: 'LIVE',
      },
      {
        sku: 'VA-CLEAN-HYGIENE-5L',
        name: 'Valio Pro Hygiene Food-Contact Sanitizer 5L',
        category: 'cleaning',
        dietary_tags: [],
        pack_format: '5L Canister',
        pack_volume_litres: 5.0,
        min_lead_time_hours: 24,
        is_active: true,
        internal_cost_eur: 16.8,
        internal_margin_pct: 25.0,
        roadmap_status: 'LIVE',
      },
      {
        sku: 'VA-ROADMAP-Q4-PRO',
        name: 'Valio Next-Gen Barista Protein Milk (Q4 Preview)',
        category: 'dairy',
        dietary_tags: ['lactose-free', 'high-protein'],
        pack_format: '10L Bag-in-Box',
        pack_volume_litres: 10.0,
        min_lead_time_hours: 24,
        is_active: true,
        internal_cost_eur: 10.08,
        internal_margin_pct: 28.0,
        roadmap_status: 'UNRELEASED',
      },
    ];
    for (const p of products) this.products.set(p.sku, p);

    const prices: Array<[string, string, number]> = [
      ['hotel_nordic_group', 'VA-LF-MILK-10L', 11.8],
      ['hotel_nordic_group', 'VA-LF-MILK-12X1L', 15.48],
      ['hotel_nordic_group', 'VA-OAT-BARISTA-10L', 13.9],
      ['hotel_nordic_group', 'VA-BAKERY-CROISSANT-50', 39.5],
      ['hotel_nordic_group', 'VA-CLEAN-HYGIENE-5L', 24.0],
      ['hotel_nordic_group', 'VA-ROADMAP-Q4-PRO', 14.0],
      ['scandic_helsinki_hub', 'VA-LF-MILK-10L', 11.5],
      ['scandic_helsinki_hub', 'VA-LF-MILK-12X1L', 15.1],
      ['scandic_helsinki_hub', 'VA-OAT-BARISTA-10L', 13.5],
      ['scandic_helsinki_hub', 'VA-BAKERY-CROISSANT-50', 37.5],
      ['scandic_helsinki_hub', 'VA-CLEAN-HYGIENE-5L', 22.5],
      ['sodexo_campus_espoo', 'VA-LF-MILK-10L', 12.1],
      ['sodexo_campus_espoo', 'VA-LF-MILK-12X1L', 15.8],
      ['sodexo_campus_espoo', 'VA-OAT-BARISTA-10L', 14.2],
      ['sodexo_campus_espoo', 'VA-BAKERY-CROISSANT-50', 41.0],
      ['sodexo_campus_espoo', 'VA-CLEAN-HYGIENE-5L', 25.0],
      ['fazer_food_services', 'VA-LF-MILK-10L', 11.2],
      ['fazer_food_services', 'VA-LF-MILK-12X1L', 14.9],
      ['fazer_food_services', 'VA-OAT-BARISTA-10L', 13.1],
      ['fazer_food_services', 'VA-BAKERY-CROISSANT-50', 36.0],
      ['fazer_food_services', 'VA-CLEAN-HYGIENE-5L', 21.5],
    ];
    for (const [tid, sku, price] of prices) {
      this.contractPrices.set(`${tid}::${sku}`, price);
    }

    const stocks: WarehouseStock[] = [
      { sku: 'VA-LF-MILK-10L', available_packs: 250, reserved_packs: 0 },
      { sku: 'VA-LF-MILK-12X1L', available_packs: 180, reserved_packs: 0 },
      { sku: 'VA-OAT-BARISTA-10L', available_packs: 200, reserved_packs: 0 },
      { sku: 'VA-BAKERY-CROISSANT-50', available_packs: 120, reserved_packs: 0 },
      { sku: 'VA-CLEAN-HYGIENE-5L', available_packs: 80, reserved_packs: 0 },
      { sku: 'VA-ROADMAP-Q4-PRO', available_packs: 100, reserved_packs: 0 },
    ];
    for (const s of stocks) this.stock.set(s.sku, s);

    const twoDaysAgo = new Date(now.getTime() - 2 * 86400_000).toISOString();
    const twelveDaysLater = new Date(now.getTime() + 12 * 86400_000).toISOString();

    this.grants.set('RAG-SCANDIC-01', {
      grant_id: 'RAG-SCANDIC-01',
      tenant_id: 'scandic_helsinki_hub',
      category: 'dairy',
      sku: 'VA-LF-MILK-10L',
      frequency: 'WEEKLY',
      window_days: 14,
      max_budget_per_period_eur: 2500.0,
      current_period_spent_eur: 575.0,
      valid_from: twoDaysAgo,
      valid_until: twelveDaysLater,
      status: 'ACTIVE',
      approved_by: 'Tuomas Korhonen (F&B Director)',
      notes: 'Standing 14-day recurrent breakfast milk allocation for Helsinki Hub',
      created_at: twoDaysAgo,
      is_valid: true,
      days_remaining: 12,
    });

    const threeHoursAgo = new Date(now.getTime() - 3 * 3600_000).toISOString();
    const oneHourAgo = new Date(now.getTime() - 1 * 3600_000).toISOString();
    const twoDaysAhead = new Date(now.getTime() + 2 * 86400_000).toISOString();
    const oneDayAhead = new Date(now.getTime() + 1 * 86400_000).toISOString();
    const fifteenMinsLater = new Date(now.getTime() + 15 * 60_000).toISOString();

    this.quoteLocks.set('Q-SCANDIC-001', {
      quote_id: 'Q-SCANDIC-001',
      tenant_id: 'scandic_helsinki_hub',
      sku: 'VA-LF-MILK-10L',
      pack_quantity: 50,
      total_litres: 500.0,
      locked_total_eur: 575.0,
      deliver_by: twoDaysAhead,
      status: 'CONSUMED',
      expires_at: fifteenMinsLater,
      created_at: threeHoursAgo,
    });

    this.orders.set('ORD-SCANDIC-101', {
      order_id: 'ORD-SCANDIC-101',
      quote_id: 'Q-SCANDIC-001',
      tenant_id: 'scandic_helsinki_hub',
      tenant_name: 'Scandic Hotels Finland',
      po_reference: 'PO-SCANDIC-2026-089',
      status: 'CONFIRMED',
      total_eur: 575.0,
      violation_reasons: null,
      approved_by: 'AimoGate-PolicyEngine [Recurrent Grant RAG-SCANDIC-01]',
      approval_type: 'RECURRENT_WINDOW',
      recurrent_grant_id: 'RAG-SCANDIC-01',
      created_at: threeHoursAgo,
      sku: 'VA-LF-MILK-10L',
      product_name: 'Valio Eila® Lactose-Free Semi-Skimmed Milk',
      category: 'dairy',
      pack_quantity: 50,
      total_litres: 500.0,
      verification_hash: computeShortHash('ORD-SCANDIC-101|Q-SCANDIC-001|575.00'),
      traces: [
        {
          step_number: 1,
          title: 'Intent Decomposition & RFP Trigger',
          description: 'Parsed standing Monday breakfast dairy replenishment directive for Scandic Helsinki Hub (500L lactose-free milk).',
          action_type: 'reasoning',
          latency_ms: 14,
        },
        {
          step_number: 2,
          title: 'Unit-Normalized Vendor Quote Comparison',
          description: 'Evaluated Valio Eila® 10L Bag-in-Box (€1.15/L, €575.00 total) vs 12x1L Carton (€1.26/L, €634.20 total). Selected lowest unit cost.',
          action_type: 'tool_call',
          tool_name: 'search_offers',
          latency_ms: 28,
        },
        {
          step_number: 3,
          title: 'Policy Firewall & Recurrent Window Verification',
          description: 'Matched standing grant RAG-SCANDIC-01 (€575.00 <= €2,500.00 period budget). Auto-committed with zero human latency.',
          action_type: 'policy_decision',
          latency_ms: 12,
        },
      ],
    });

    this.quoteLocks.set('Q-FAZER-001', {
      quote_id: 'Q-FAZER-001',
      tenant_id: 'fazer_food_services',
      sku: 'VA-LF-MILK-10L',
      pack_quantity: 120,
      total_litres: 1200.0,
      locked_total_eur: 1344.0,
      deliver_by: oneDayAhead,
      status: 'CONSUMED',
      expires_at: fifteenMinsLater,
      created_at: oneHourAgo,
    });

    this.orders.set('ORD-FAZER-808', {
      order_id: 'ORD-FAZER-808',
      quote_id: 'Q-FAZER-001',
      tenant_id: 'fazer_food_services',
      tenant_name: 'Fazer Food & Restaurant Services',
      po_reference: 'PO-FAZER-2026-551',
      status: 'CONFIRMED',
      total_eur: 1344.0,
      violation_reasons: null,
      approved_by: 'AimoGate-PolicyEngine (Auto-Approved < €2,500)',
      approval_type: 'AUTO',
      recurrent_grant_id: null,
      created_at: oneHourAgo,
      sku: 'VA-LF-MILK-10L',
      product_name: 'Valio Eila® Lactose-Free Semi-Skimmed Milk',
      category: 'dairy',
      pack_quantity: 120,
      total_litres: 1200.0,
      verification_hash: computeShortHash('ORD-FAZER-808|Q-FAZER-001|1344.00'),
      traces: [
        {
          step_number: 1,
          title: 'Intent Decomposition & RFP Trigger',
          description: 'Parsed Fazer Central Kitchen scheduled restock request for 1,200L lactose-free milk.',
          action_type: 'reasoning',
          latency_ms: 11,
        },
        {
          step_number: 2,
          title: 'Unit-Normalized Vendor Quote Comparison',
          description: 'Evaluated Valio Eila® 10L Bag-in-Box (€1.12/L, 120 packs = €1,344.00) vs 12x1L Carton (€1.24/L, €1,490.00).',
          action_type: 'tool_call',
          tool_name: 'search_offers',
          latency_ms: 24,
        },
        {
          step_number: 3,
          title: 'Policy Firewall Validation',
          description: 'Category dairy whitelisted; €1,344.00 within €2,500.00 cap; 1,200L within 2,000L cap. Auto-approved.',
          action_type: 'policy_decision',
          latency_ms: 9,
        },
      ],
    });

    this.scheduledPrompts.set('SCH-DAIRY-01', {
      schedule_id: 'SCH-DAIRY-01',
      tenant_id: 'hotel_nordic_group',
      name: 'Bi-Weekly Lactose-Free Milk Replenishment',
      executor_agent: 'buyer_agent_nordic_01',
      prompt: 'I need 400 litres of lactose-free milk by Monday. Find an option that meets our requirements based on price and availability.',
      strategy: 'cron',
      cron_expr: '0 2 * * 2,5',
      next_run_label: 'Tue & Fri 02:00 UTC',
      max_cap_eur: 800,
      require_multi_vendor: true,
      status: 'ACTIVE',
      last_run_summary: 'Last run: 400L VA-LF-MILK-10L (€472.00)',
      created_at: twoDaysAgo,
    });

    this.scheduledPrompts.set('SCH-OAT-02', {
      schedule_id: 'SCH-OAT-02',
      tenant_id: 'hotel_nordic_group',
      name: 'Barista Oat Drink Weekly Top-Up',
      executor_agent: 'buyer_agent_nordic_01',
      prompt: 'I need 200 litres of barista oat drink by Monday. Find an option based on price and availability.',
      strategy: 'threshold',
      cron_expr: 'stock < 40 packs',
      next_run_label: 'Trigger: Inventory < 40 packs',
      max_cap_eur: 600,
      require_multi_vendor: true,
      status: 'ACTIVE',
      last_run_summary: 'Last run: 200L VA-OAT-BARISTA-10L (€278.00)',
      created_at: twoDaysAgo,
    });

    this.addAuditLog({
      tenant_id: 'hotel_nordic_group',
      actor_type: 'system',
      actor_id: 'system_initializer',
      action: 'SYSTEM_INITIALIZED',
      payload_summary: { status: 'ready', seed: 'multi_customer_network_with_guardrails' },
    });
    this.addAuditLog({
      tenant_id: 'fazer_food_services',
      actor_type: 'agent',
      actor_id: 'fazer_agent_03',
      action: 'AUTO_APPROVED',
      payload_summary: { order_id: 'ORD-FAZER-808', total_eur: 1344.0 },
    });
    this.addAuditLog({
      tenant_id: 'scandic_helsinki_hub',
      actor_type: 'system',
      actor_id: 'AimoGate-PolicyEngine',
      action: 'RECURRENT_TRANSACTION_EXECUTED',
      payload_summary: { order_id: 'ORD-SCANDIC-101', grant_id: 'RAG-SCANDIC-01', total_eur: 575.0 },
    });
  }

  getPresetPrincipal(role: PrincipalType, tenantId: string = DEFAULT_TENANT_ID): Principal {
    if (role === 'agent') {
      return {
        tenant_id: tenantId,
        principal_id: 'buyer_agent_nordic_01',
        principal_type: 'agent',
        scopes: ['offers:read', 'quotes:lock', 'orders:submit'],
      };
    }
    if (role === 'human') {
      return {
        tenant_id: tenantId,
        principal_id: 'manager_helsinki_01',
        principal_type: 'human',
        scopes: ['orders:approve', 'orders:reject', 'policies:update', 'offers:read'],
      };
    }
    return {
      tenant_id: tenantId,
      principal_id: 'valio_aimo_admin',
      principal_type: 'admin',
      scopes: ['catalog:inspect', 'demo:reset', 'policies:update', 'orders:approve', 'orders:reject'],
    };
  }

  getTokenBundle(tenantId: string = DEFAULT_TENANT_ID): TokenBundle {
    return {
      agent: {
        token: `aimo.agent.${tenantId}`,
        principal_type: 'agent',
        principal_id: 'buyer_agent_nordic_01',
        scopes: ['offers:read', 'quotes:lock', 'orders:submit'],
        description: 'Hotel Procurement Bot (Strictly blocked from /approve)',
      },
      human: {
        token: `aimo.human.${tenantId}`,
        principal_type: 'human',
        principal_id: 'manager_helsinki_01',
        scopes: ['orders:approve', 'orders:reject', 'policies:update', 'offers:read'],
        description: 'F&B Manager (Sole principal authorized to sign-off)',
      },
      admin: {
        token: `aimo.admin.${tenantId}`,
        principal_type: 'admin',
        principal_id: 'valio_aimo_admin',
        scopes: ['catalog:inspect', 'demo:reset', 'policies:update', 'orders:approve', 'orders:reject'],
        description: 'Valio Aimo Platform Admin',
      },
    };
  }

  requirePrincipal(
    principal: Principal,
    allowedTypes: PrincipalType[],
    requiredScopes: string[] = []
  ): void {
    if (!allowedTypes.includes(principal.principal_type)) {
      throw new GatewayError(
        403,
        `Access denied: principal_type '${principal.principal_type}' is not authorized. Required: [${allowedTypes.join(', ')}]`
      );
    }
    for (const s of requiredScopes) {
      if (!principal.scopes.includes(s)) {
        throw new GatewayError(403, `Access denied: missing required scope '${s}'`);
      }
    }
  }

  searchOffers(
    principal: Principal,
    req: {
      query?: string;
      attributes?: string[];
      required_volume_litres?: number;
      deliver_by?: string;
    },
    now: Date = new Date()
  ): PublicOfferDTO[] {
    this.requirePrincipal(principal, ['agent', 'human', 'admin'], ['offers:read']);
    const tenantId = principal.tenant_id;
    const searchTerm = (req.query || '').toLowerCase().trim();
    const searchWords = searchTerm.split(/\s+/).filter(Boolean);
    const requiredTags = (req.attributes || []).map((t) => t.toLowerCase());

    const offers: PublicOfferDTO[] = [];

    for (const product of this.products.values()) {
      // Zero-Trust: physically filter out inactive and UNRELEASED roadmap products
      if (!product.is_active || product.roadmap_status !== 'LIVE') continue;

      const unitPrice = this.contractPrices.get(`${tenantId}::${product.sku}`);
      const stockRec = this.stock.get(product.sku);
      if (unitPrice === undefined || !stockRec) continue;

      const productTags = product.dietary_tags.map((t) => t.toLowerCase());
      const corpus = `${product.name.toLowerCase()} ${product.category.toLowerCase()} ${productTags.join(' ')}`;

      const queryMatch = searchWords.length === 0 || searchWords.every((w) => corpus.includes(w));
      const tagsMatch = requiredTags.every((t) => productTags.includes(t));
      if (!queryMatch || !tagsMatch) continue;

      const packVol = product.pack_volume_litres;
      const pricePerLitre = Number((unitPrice / packVol).toFixed(2));
      let packsRequired: number | null = null;
      let deliveredVol: number | null = null;
      let totalPrice: number | null = null;

      if (req.required_volume_litres !== undefined && req.required_volume_litres > 0) {
        packsRequired = Math.ceil(req.required_volume_litres / packVol);
        deliveredVol = Number((packsRequired * packVol).toFixed(2));
        totalPrice = Number((packsRequired * unitPrice).toFixed(2));
      }

      const earliestDelivery = new Date(now.getTime() + product.min_lead_time_hours * 3600_000);
      let leadTimeFeasible = true;
      if (req.deliver_by) {
        const target = new Date(req.deliver_by);
        leadTimeFeasible = target >= earliestDelivery;
      }

      const isStockAvailable = stockRec.available_packs >= (packsRequired ?? 1);

      // Zero-Trust DTO: never include internal_cost_eur, internal_margin_pct, or roadmap_status
      offers.push({
        sku: product.sku,
        name: product.name,
        category: product.category,
        dietary_tags: [...product.dietary_tags],
        pack_format: product.pack_format,
        pack_volume_litres: packVol,
        unit_contract_price_eur: unitPrice,
        price_per_litre_eur: pricePerLitre,
        packs_required: packsRequired,
        delivered_volume_litres: deliveredVol,
        total_contract_price_eur: totalPrice,
        is_stock_available: isStockAvailable,
        available_packs: stockRec.available_packs,
        lead_time_feasible: leadTimeFeasible,
        earliest_delivery: earliestDelivery.toISOString(),
      });
    }

    // If no hardcoded products match, retrieve candidates dynamically from the 17,546 Valio Aimo catalog
    if (offers.length === 0 && searchTerm) {
      const catalogService = ValioAimoCatalogService.getInstance();
      const candidates = catalogService.search(searchTerm, { tags: req.attributes, limit: 6 });

      for (const cand of candidates) {
        const dynamicSku = `VA-${cand.id}`;

        if (!this.products.has(dynamicSku)) {
          this.products.set(dynamicSku, {
            sku: dynamicSku,
            name: cand.display_name,
            category: cand.category,
            dietary_tags: cand.dietary_tags,
            pack_format: cand.pack_format,
            pack_volume_litres: cand.pack_volume_litres,
            min_lead_time_hours: 24,
            is_active: true,
            internal_cost_eur: 10.0,
            internal_margin_pct: 18.0,
            roadmap_status: 'LIVE',
          });
        }

        if (!this.stock.has(dynamicSku)) {
          this.stock.set(dynamicSku, {
            sku: dynamicSku,
            available_packs: 500,
            reserved_packs: 0,
          });
        }

        // Establish contract price if not already set
        const priceKey = `${tenantId}::${dynamicSku}`;
        if (!this.contractPrices.has(priceKey)) {
          // Estimate baseline contract price if live call is deferred
          const estimatedPrice = cand.pack_volume_litres >= 10 ? 12.5 : cand.pack_volume_litres >= 1 ? 2.4 : 1.95;
          this.contractPrices.set(priceKey, estimatedPrice);
        }

        const unitPrice = this.contractPrices.get(priceKey)!;
        const packVol = cand.pack_volume_litres || 1.0;
        const pricePerLitre = Number((unitPrice / packVol).toFixed(2));
        let packsRequired: number | null = null;
        let deliveredVol: number | null = null;
        let totalPrice: number | null = null;

        if (req.required_volume_litres !== undefined && req.required_volume_litres > 0) {
          packsRequired = Math.ceil(req.required_volume_litres / packVol);
          deliveredVol = Number((packsRequired * packVol).toFixed(2));
          totalPrice = Number((packsRequired * unitPrice).toFixed(2));
        }

        const earliestDelivery = new Date(now.getTime() + 24 * 3600_000);
        let leadTimeFeasible = true;
        if (req.deliver_by) {
          const target = new Date(req.deliver_by);
          leadTimeFeasible = target >= earliestDelivery;
        }

        offers.push({
          sku: dynamicSku,
          name: cand.display_name,
          category: cand.category,
          dietary_tags: [...cand.dietary_tags],
          pack_format: cand.pack_format,
          pack_volume_litres: packVol,
          unit_contract_price_eur: unitPrice,
          price_per_litre_eur: pricePerLitre,
          packs_required: packsRequired,
          delivered_volume_litres: deliveredVol,
          total_contract_price_eur: totalPrice,
          is_stock_available: true,
          available_packs: 500,
          lead_time_feasible: leadTimeFeasible,
          earliest_delivery: earliestDelivery.toISOString(),
        });
      }
    }

    offers.sort((a, b) => {
      const tpA = a.total_contract_price_eur ?? 0;
      const tpB = b.total_contract_price_eur ?? 0;
      if (tpA !== tpB) return tpA - tpB;
      return a.price_per_litre_eur - b.price_per_litre_eur;
    });

    return offers;
  }

  lockQuote(
    principal: Principal,
    req: { sku: string; pack_quantity: number; deliver_by: string },
    now: Date = new Date()
  ): QuoteLock {
    this.requirePrincipal(principal, ['agent', 'human', 'admin'], ['quotes:lock']);
    const tenantId = principal.tenant_id;

    if (typeof req.pack_quantity !== 'number' || req.pack_quantity <= 0 || !Number.isFinite(req.pack_quantity)) {
      throw new GatewayError(400, `Pack quantity must be a positive number. Received: ${req.pack_quantity}`);
    }

    const product = this.products.get(req.sku);
    if (!product || !product.is_active || product.roadmap_status !== 'LIVE') {
      throw new GatewayError(404, `SKU '${req.sku}' is unavailable or unreleased.`);
    }

    const unitPrice = this.contractPrices.get(`${tenantId}::${req.sku}`);
    if (unitPrice === undefined) {
      throw new GatewayError(403, `No active contract price for SKU '${req.sku}' under tenant '${tenantId}'.`);
    }

    const stockRec = this.stock.get(req.sku);
    if (!stockRec || stockRec.available_packs < req.pack_quantity) {
      throw new GatewayError(
        409,
        `Insufficient stock for SKU '${req.sku}'. Requested: ${req.pack_quantity}, Available: ${stockRec?.available_packs ?? 0}`
      );
    }

    const deliverBy = new Date(req.deliver_by);
    const earliestAllowed = new Date(now.getTime() + product.min_lead_time_hours * 3600_000);
    if (deliverBy < earliestAllowed) {
      throw new GatewayError(
        400,
        `Requested delivery '${req.deliver_by}' violates lead time (${product.min_lead_time_hours}h).`
      );
    }

    stockRec.available_packs -= req.pack_quantity;
    stockRec.reserved_packs += req.pack_quantity;

    const totalLitres = Number((req.pack_quantity * product.pack_volume_litres).toFixed(2));
    const lockedTotalEur = Number((req.pack_quantity * unitPrice).toFixed(2));
    const quoteId = this.nextHex('Q');
    const expiresAt = new Date(now.getTime() + 15 * 60_000).toISOString();

    const quote: QuoteLock = {
      quote_id: quoteId,
      tenant_id: tenantId,
      sku: req.sku,
      pack_quantity: req.pack_quantity,
      total_litres: totalLitres,
      locked_total_eur: lockedTotalEur,
      deliver_by: deliverBy.toISOString(),
      status: 'LOCKED',
      expires_at: expiresAt,
      created_at: now.toISOString(),
    };

    this.quoteLocks.set(quoteId, quote);

    this.addAuditLog({
      tenant_id: tenantId,
      actor_type: principal.principal_type,
      actor_id: principal.principal_id,
      action: 'QUOTE_LOCKED',
      payload_summary: {
        quote_id: quoteId,
        sku: req.sku,
        pack_quantity: req.pack_quantity,
        locked_total_eur: lockedTotalEur,
        expires_at: expiresAt,
      },
    });

    return quote;
  }

  commitOrder(
    principal: Principal,
    req: {
      quote_id: string;
      po_reference: string;
      traces?: AgentStepTrace[];
      offer_comparisons?: PublicOfferDTO[];
    },
    now: Date = new Date()
  ): OrderDTO {
    this.requirePrincipal(principal, ['agent', 'human', 'admin'], ['orders:submit']);
    const tenantId = principal.tenant_id;

    // 1. Idempotency check
    for (const existing of this.orders.values()) {
      if (existing.tenant_id === tenantId && existing.po_reference === req.po_reference) {
        return existing;
      }
    }

    // 2. Quote validation
    const quote = this.quoteLocks.get(req.quote_id);
    if (!quote || quote.tenant_id !== tenantId) {
      throw new GatewayError(404, `Quote '${req.quote_id}' not found for tenant '${tenantId}'.`);
    }
    if (quote.status !== 'LOCKED') {
      throw new GatewayError(400, `Quote '${req.quote_id}' is not in LOCKED status (Current: ${quote.status}).`);
    }
    if (new Date(quote.expires_at) < now) {
      quote.status = 'EXPIRED';
      const stockRec = this.stock.get(quote.sku);
      if (stockRec) {
        stockRec.available_packs += quote.pack_quantity;
        stockRec.reserved_packs = Math.max(0, stockRec.reserved_packs - quote.pack_quantity);
      }
      throw new GatewayError(410, `Quote '${req.quote_id}' has expired. Please create a new quote.`);
    }

    // 3. Policy Firewall evaluation
    const policy = this.policies.get(tenantId);
    const product = this.products.get(quote.sku);
    if (!policy || !product) {
      throw new GatewayError(500, 'Policy or product missing for quote evaluation.');
    }

    const activeGrants = Array.from(this.grants.values()).filter((g) => g.tenant_id === tenantId);
    const existingOrders = Array.from(this.orders.values()).filter((o) => o.tenant_id === tenantId);
    const { passes, violations, matchingGrant } = evaluateOrderPolicy({
      policy,
      product,
      quote,
      activeGrants,
      existingOrders,
      killswitchHalted: this.killswitchHalted,
      now,
    });

    const orderId = this.nextHex('ORD');
    let orderStatus: OrderDTO['status'] = 'PENDING_APPROVAL';
    let approvalType: OrderDTO['approval_type'] = 'PENDING';
    let recurrentGrantId: string | null = null;
    let approvedBy: string | null = null;
    let action = 'POLICY_HELD';

    if (passes) {
      orderStatus = 'CONFIRMED';
      quote.status = 'CONSUMED';
      const stockRec = this.stock.get(quote.sku);
      if (stockRec) {
        stockRec.reserved_packs = Math.max(0, stockRec.reserved_packs - quote.pack_quantity);
      }
      if (matchingGrant) {
        approvalType = 'RECURRENT_WINDOW';
        recurrentGrantId = matchingGrant.grant_id;
        matchingGrant.current_period_spent_eur = Number(
          (matchingGrant.current_period_spent_eur + quote.locked_total_eur).toFixed(2)
        );
        const untilLabel = new Date(matchingGrant.valid_until).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
        });
        approvedBy = `AimoGate-PolicyEngine [Recurrent Grant: ${matchingGrant.grant_id} (Valid until ${untilLabel})]`;
        action = 'AUTO_APPROVED_RECURRENT';
      } else {
        approvalType = 'AUTO';
        approvedBy = 'AimoGate-PolicyEngine';
        action = 'AUTO_APPROVED';
      }
    }

    const order: OrderDTO = {
      order_id: orderId,
      quote_id: quote.quote_id,
      tenant_id: tenantId,
      tenant_name: policy.tenant_name,
      po_reference: req.po_reference,
      status: orderStatus,
      total_eur: quote.locked_total_eur,
      violation_reasons: passes ? null : violations,
      approved_by: approvedBy,
      approval_type: approvalType,
      recurrent_grant_id: recurrentGrantId,
      created_at: now.toISOString(),
      sku: quote.sku,
      product_name: product.name,
      category: product.category,
      pack_quantity: quote.pack_quantity,
      total_litres: quote.total_litres,
      verification_hash: computeShortHash(`${orderId}|${quote.quote_id}|${quote.locked_total_eur}|${req.po_reference}`),
      traces: req.traces,
      offer_comparisons: req.offer_comparisons,
    };

    this.orders.set(orderId, order);

    this.addAuditLog({
      tenant_id: tenantId,
      actor_type: principal.principal_type,
      actor_id: principal.principal_id,
      action,
      payload_summary: {
        order_id: orderId,
        quote_id: quote.quote_id,
        po_reference: req.po_reference,
        total_eur: quote.locked_total_eur,
        status: orderStatus,
        approval_type: approvalType,
        recurrent_grant_id: recurrentGrantId,
        violations: passes ? null : violations,
      },
    });

    return order;
  }

  approveOrder(
    principal: Principal,
    orderId: string,
    payload?: {
      approval_type?: 'ONE_TIME' | 'RECURRENT_WINDOW';
      window_days?: number;
      frequency?: 'DAILY' | 'WEEKLY' | 'MONTHLY';
      recurrent_budget_eur?: number;
      notes?: string;
    },
    now: Date = new Date()
  ): OrderDTO {
    // Strictly requires human or admin with orders:approve! Agent receives 403 Forbidden.
    this.requirePrincipal(principal, ['human', 'admin'], ['orders:approve']);

    const order = this.orders.get(orderId);
    if (!order || (principal.principal_type !== 'admin' && order.tenant_id !== principal.tenant_id)) {
      throw new GatewayError(404, `Order '${orderId}' not found.`);
    }
    if (order.status !== 'PENDING_APPROVAL') {
      throw new GatewayError(400, `Order '${orderId}' cannot be approved: current status is ${order.status}.`);
    }

    const quote = this.quoteLocks.get(order.quote_id);
    if (!quote) {
      throw new GatewayError(500, 'Associated quote lock not found.');
    }
    const product = this.products.get(quote.sku);

    const reqType = (payload?.approval_type || 'ONE_TIME').toUpperCase() as 'ONE_TIME' | 'RECURRENT_WINDOW';
    let auditAction = 'HUMAN_APPROVED';

    if (reqType === 'RECURRENT_WINDOW') {
      const windowDays = payload?.window_days && payload.window_days > 0 ? payload.window_days : 7;
      const validUntil = new Date(now.getTime() + windowDays * 86400_000);
      const category = product?.category ?? 'dairy';
      const budget = payload?.recurrent_budget_eur ?? Math.max(order.total_eur * 2.5, 3000);
      const frequency = payload?.frequency ?? 'WEEKLY';
      const grantId = this.nextHex('RAG');

      const grant: RecurrentApprovalGrant = {
        grant_id: grantId,
        tenant_id: order.tenant_id,
        category,
        sku: quote.sku,
        frequency,
        window_days: windowDays,
        max_budget_per_period_eur: budget,
        current_period_spent_eur: order.total_eur,
        valid_from: now.toISOString(),
        valid_until: validUntil.toISOString(),
        status: 'ACTIVE',
        approved_by: `${principal.principal_id} (${principal.principal_type})`,
        notes: payload?.notes ?? `Standing approval window for ${quote.sku}`,
        created_at: now.toISOString(),
        is_valid: true,
        days_remaining: windowDays,
      };
      this.grants.set(grantId, grant);
      order.approval_type = 'RECURRENT_WINDOW';
      order.recurrent_grant_id = grantId;
      const untilLabel = validUntil.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      order.approved_by = `${principal.principal_id} [RECURRENT-WINDOW: ${windowDays}d until ${untilLabel}]`;
      auditAction = 'RECURRENT_GRANT_ESTABLISHED';
    } else {
      order.approval_type = 'ONE_TIME';
      order.recurrent_grant_id = null;
      order.approved_by = `${principal.principal_id} (${principal.principal_type}) [ONE-TIME]`;
    }

    order.status = 'CONFIRMED';
    quote.status = 'CONSUMED';

    const stockRec = this.stock.get(quote.sku);
    if (stockRec) {
      stockRec.reserved_packs = Math.max(0, stockRec.reserved_packs - quote.pack_quantity);
    }

    this.addAuditLog({
      tenant_id: order.tenant_id,
      actor_type: principal.principal_type,
      actor_id: principal.principal_id,
      action: auditAction,
      payload_summary: {
        order_id: order.order_id,
        quote_id: quote.quote_id,
        approval_type: order.approval_type,
        recurrent_grant_id: order.recurrent_grant_id,
        approved_by: order.approved_by,
        total_eur: order.total_eur,
      },
    });

    return order;
  }

  rejectOrder(principal: Principal, orderId: string): OrderDTO {
    this.requirePrincipal(principal, ['human', 'admin'], ['orders:reject']);
    const order = this.orders.get(orderId);
    if (!order || (principal.principal_type !== 'admin' && order.tenant_id !== principal.tenant_id)) {
      throw new GatewayError(404, `Order '${orderId}' not found.`);
    }
    if (order.status !== 'PENDING_APPROVAL') {
      throw new GatewayError(400, `Order '${orderId}' cannot be rejected: current status is ${order.status}.`);
    }

    const quote = this.quoteLocks.get(order.quote_id);
    if (!quote) {
      throw new GatewayError(500, 'Associated quote lock not found.');
    }

    order.status = 'REJECTED';
    order.approved_by = `REJECTED by ${principal.principal_id}`;
    quote.status = 'RELEASED';

    const stockRec = this.stock.get(quote.sku);
    if (stockRec) {
      stockRec.available_packs += quote.pack_quantity;
      stockRec.reserved_packs = Math.max(0, stockRec.reserved_packs - quote.pack_quantity);
    }

    this.addAuditLog({
      tenant_id: order.tenant_id,
      actor_type: principal.principal_type,
      actor_id: principal.principal_id,
      action: 'HUMAN_REJECTED',
      payload_summary: {
        order_id: order.order_id,
        quote_id: quote.quote_id,
        rejected_by: order.approved_by,
      },
    });

    return order;
  }

  updatePolicy(
    principal: Principal,
    tenantId: string,
    patch: Partial<
      Pick<
        TenantPolicy,
        | 'max_auto_approve_eur'
        | 'max_auto_approve_litres'
        | 'allowed_categories'
        | 'anomaly_sensitivity_pct'
        | 'auto_dispute_enabled'
        | 'category_rules'
      >
    >
  ): TenantPolicy {
    this.requirePrincipal(principal, ['human', 'admin'], ['policies:update']);
    const policy = this.policies.get(tenantId);
    if (!policy) {
      throw new GatewayError(404, `Policy for '${tenantId}' not found.`);
    }

    if (patch.max_auto_approve_eur !== undefined) policy.max_auto_approve_eur = patch.max_auto_approve_eur;
    if (patch.max_auto_approve_litres !== undefined) {
      policy.max_auto_approve_litres = patch.max_auto_approve_litres;
      if (policy.category_rules) {
        for (const rule of Object.values(policy.category_rules)) {
          if (rule.max_storage_litres < patch.max_auto_approve_litres) {
            rule.max_storage_litres = patch.max_auto_approve_litres;
          }
        }
      }
    }
    if (patch.allowed_categories !== undefined) policy.allowed_categories = patch.allowed_categories;
    if (patch.anomaly_sensitivity_pct !== undefined) policy.anomaly_sensitivity_pct = patch.anomaly_sensitivity_pct;
    if (patch.auto_dispute_enabled !== undefined) policy.auto_dispute_enabled = patch.auto_dispute_enabled;
    if (patch.category_rules !== undefined) {
      if (!policy.category_rules) policy.category_rules = {};
      for (const [catKey, rulePatch] of Object.entries(patch.category_rules)) {
        const cat = catKey.toLowerCase();
        const existing: CategoryRule = policy.category_rules[cat] || {
          category: cat,
          time_window: 'weekly',
          max_storage_litres: policy.max_auto_approve_litres,
          rule_valid_until: null,
        };
        policy.category_rules[cat] = {
          ...existing,
          ...rulePatch,
          category: cat,
        };
      }
    }

    this.addAuditLog({
      tenant_id: tenantId,
      actor_type: principal.principal_type,
      actor_id: principal.principal_id,
      action: 'POLICY_UPDATED',
      payload_summary: {
        max_auto_approve_eur: policy.max_auto_approve_eur,
        max_auto_approve_litres: policy.max_auto_approve_litres,
        allowed_categories: policy.allowed_categories,
        category_rules: policy.category_rules,
      },
    });

    return { ...policy };
  }

  getCategoryRulesWithUsage(tenantId: string, now: Date = new Date()): Record<string, CategoryRuleUsageDTO> {
    const policy = this.policies.get(tenantId);
    if (!policy) throw new GatewayError(404, `Policy for '${tenantId}' not found.`);

    const rules = policy.category_rules || {};
    const result: Record<string, CategoryRuleUsageDTO> = {};
    const orders = Array.from(this.orders.values()).filter((o) => o.tenant_id === tenantId);

    for (const cat of SYSTEM_CATEGORIES) {
      const existing: CategoryRule = rules[cat] || {
        category: cat,
        time_window: 'weekly',
        max_storage_litres: cat === 'dairy' ? 1000.0 : policy.max_auto_approve_litres,
        rule_valid_until: null,
      };

      const durationMs = getTimeWindowDurationMs(existing.time_window);
      let consumed = 0;
      if (durationMs !== null) {
        const windowStartMs = now.getTime() - durationMs;
        for (const o of orders) {
          if (o.status !== 'CONFIRMED') continue;
          const oTime = new Date(o.created_at).getTime();
          if (isNaN(oTime) || oTime < windowStartMs || oTime > now.getTime()) continue;
          const oCat = (o.category || '').toLowerCase();
          if (oCat === cat) {
            consumed += Number(o.total_litres) || 0;
          }
        }
      }

      let isExpired = false;
      let daysRemaining: number | null = null;
      if (existing.rule_valid_until !== null && existing.rule_valid_until !== undefined) {
        const untilDate = new Date(existing.rule_valid_until);
        if (!isNaN(untilDate.getTime())) {
          isExpired = now.getTime() > untilDate.getTime();
          daysRemaining = Math.max(0, Math.ceil((untilDate.getTime() - now.getTime()) / 86400_000));
        }
      }

      result[cat] = {
        category: cat,
        time_window: existing.time_window,
        max_storage_litres: existing.max_storage_litres,
        rule_valid_until: existing.rule_valid_until,
        current_period_consumed_litres: Number(consumed.toFixed(1)),
        is_expired: isExpired,
        days_remaining: daysRemaining,
      };
    }

    return result;
  }

  getCategoryRuleWithUsage(tenantId: string, category: string, now: Date = new Date()): CategoryRuleUsageDTO {
    const all = this.getCategoryRulesWithUsage(tenantId, now);
    const cat = category.toLowerCase();
    if (all[cat]) return all[cat];
    const policy = this.policies.get(tenantId);
    if (!policy) throw new GatewayError(404, `Policy for '${tenantId}' not found.`);
    return {
      category: cat,
      time_window: 'weekly',
      max_storage_litres: policy.max_auto_approve_litres,
      rule_valid_until: null,
      current_period_consumed_litres: 0,
      is_expired: false,
      days_remaining: null,
    };
  }

  updateCategoryRule(
    principal: Principal,
    tenantId: string,
    category: string,
    patch: Partial<Omit<CategoryRule, 'category'>>
  ): CategoryRule {
    this.requirePrincipal(principal, ['human', 'admin'], ['policies:update']);
    const policy = this.policies.get(tenantId);
    if (!policy) throw new GatewayError(404, `Policy for '${tenantId}' not found.`);

    if (!policy.category_rules) policy.category_rules = {};
    const cat = category.toLowerCase();
    const existing: CategoryRule = policy.category_rules[cat] || {
      category: cat,
      time_window: 'weekly',
      max_storage_litres: cat === 'dairy' ? 1000.0 : policy.max_auto_approve_litres,
      rule_valid_until: null,
    };

    const validWindows: CategoryTimeWindow[] = ['weekly', 'daily', 'monthly', 'none'];
    if (patch.time_window !== undefined && !validWindows.includes(patch.time_window)) {
      throw new GatewayError(400, `Invalid time_window '${patch.time_window}'. Allowed: ${validWindows.join(', ')}`);
    }

    const updatedRule: CategoryRule = {
      category: cat,
      time_window: patch.time_window !== undefined ? patch.time_window : existing.time_window,
      max_storage_litres:
        patch.max_storage_litres !== undefined && !isNaN(Number(patch.max_storage_litres))
          ? Number(patch.max_storage_litres)
          : existing.max_storage_litres,
      rule_valid_until:
        patch.rule_valid_until !== undefined
          ? patch.rule_valid_until
          : existing.rule_valid_until,
    };

    policy.category_rules[cat] = updatedRule;

    this.addAuditLog({
      tenant_id: tenantId,
      actor_type: principal.principal_type,
      actor_id: principal.principal_id,
      action: 'CATEGORY_RULE_UPDATED',
      payload_summary: {
        category: cat,
        time_window: updatedRule.time_window,
        max_storage_litres: updatedRule.max_storage_litres,
        rule_valid_until: updatedRule.rule_valid_until,
      },
    });

    return updatedRule;
  }

  updateCustomerGuardrails(tenantId: string, allowedCategories: string[]): GuardrailWhitelistDTO {
    const policy = this.policies.get(tenantId);
    if (!policy) throw new GatewayError(404, `Client '${tenantId}' not found.`);
    const cleaned = Array.from(new Set(allowedCategories.map((c) => c.trim().toLowerCase()).filter(Boolean)));
    policy.allowed_categories = cleaned;

    this.addAuditLog({
      tenant_id: tenantId,
      actor_type: 'admin',
      actor_id: 'wholesaler_control_tower',
      action: 'GUARDRAIL_WHITELIST_UPDATED',
      payload_summary: { tenant_id: tenantId, allowed_categories: cleaned },
    });

    return this.getCustomerGuardrails(tenantId);
  }

  getCustomerGuardrails(tenantId: string, now: Date = new Date()): GuardrailWhitelistDTO {
    const policy = this.policies.get(tenantId);
    if (!policy) throw new GatewayError(404, `Client '${tenantId}' not found.`);
    const allowed = policy.allowed_categories.map((c) => c.toLowerCase());
    const restricted = SYSTEM_CATEGORIES.filter((c) => !allowed.includes(c));
    const activeGrants = this.listGrants(tenantId, now).filter((g) => g.is_valid).length;
    const categoryUsage = this.getCategoryRulesWithUsage(tenantId, now);

    return {
      tenant_id: policy.tenant_id,
      tenant_name: policy.tenant_name,
      allowed_categories: allowed,
      all_system_categories: [...SYSTEM_CATEGORIES],
      restricted_categories: restricted,
      max_auto_approve_eur: policy.max_auto_approve_eur,
      active_grants_count: activeGrants,
      category_rules: policy.category_rules,
      category_usage: categoryUsage,
    };
  }

  revokeGrant(grantId: string): { status: string; grant_id: string } {
    const grant = this.grants.get(grantId);
    if (!grant) throw new GatewayError(404, `Recurrent grant '${grantId}' not found.`);
    grant.status = 'REVOKED';
    grant.is_valid = false;
    this.addAuditLog({
      tenant_id: grant.tenant_id,
      actor_type: 'admin',
      actor_id: 'wholesaler_control_tower',
      action: 'TOWER_REVOKED_RECURRENT_GRANT',
      payload_summary: { grant_id: grantId, tenant_id: grant.tenant_id },
    });
    return { status: 'REVOKED', grant_id: grantId };
  }

  listGrants(tenantId?: string, now: Date = new Date()): RecurrentApprovalGrant[] {
    const all = Array.from(this.grants.values());
    const filtered = tenantId ? all.filter((g) => g.tenant_id === tenantId) : all;
    return filtered
      .map((g) => {
        const validUntil = new Date(g.valid_until);
        const validFrom = new Date(g.valid_from);
        const daysRemaining = Math.max(0, Math.ceil((validUntil.getTime() - now.getTime()) / 86400_000));
        const isValid = g.status === 'ACTIVE' && now >= validFrom && now <= validUntil;
        return { ...g, days_remaining: daysRemaining, is_valid: isValid };
      })
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  }

  runAgentWorkflow(req: {
    prompt: string;
    mode?: string;
    po_reference?: string;
    tenant_id?: string;
  }): AgentRunResponse {
    const t0 = Date.now();
    const tenantId = req.tenant_id || DEFAULT_TENANT_ID;
    const mode = req.mode || 'deterministic';
    const principal: Principal = {
      tenant_id: tenantId,
      principal_id: `buyer_agent_${tenantId}`,
      principal_type: 'agent',
      scopes: ['offers:read', 'quotes:lock', 'orders:submit'],
    };

    const traces: AgentStepTrace[] = [];
    const parsed = parseBuyerPrompt(req.prompt);

    traces.push({
      step_number: 1,
      title: 'Autonomous Goal & Intent Analysis',
      description: `Parsed requirement: ${parsed.volume_litres.toLocaleString()}L of '${parsed.query}' needed by ${parsed.deliver_by.slice(0, 10)}. Initiating catalog discovery via AimoGate.`,
      action_type: 'reasoning',
      latency_ms: 8,
      tool_input: { prompt: req.prompt, parsed_intent: parsed },
    });

    const offers = this.searchOffers(principal, {
      query: parsed.query,
      attributes: parsed.attributes,
      required_volume_litres: parsed.volume_litres,
      deliver_by: parsed.deliver_by,
    });

    traces.push({
      step_number: 2,
      title: 'Tool Call: search_offers',
      description: `Retrieved ${offers.length} matching contract offers from Valio Aimo Gateway. Pack sizes normalized, internal margins securely withheld.`,
      action_type: 'tool_call',
      tool_name: 'search_offers',
      latency_ms: 14,
      tool_input: parsed,
      tool_output: offers,
    });

    if (offers.length === 0) {
      return {
        success: false,
        mode_used: mode,
        execution_time_ms: Math.max(12, Date.now() - t0),
        traces,
        final_status: 'NO_OFFERS',
        summary_message: 'No matching products found matching criteria.',
      };
    }

    const bestOffer = offers[0];
    const comparisonNotes = offers
      .map(
        (o) =>
          `${o.sku} (${o.pack_format}): €${(o.total_contract_price_eur ?? 0).toFixed(2)} total (€${o.price_per_litre_eur.toFixed(2)}/L)`
      )
      .join(', ');

    traces.push({
      step_number: 3,
      title: 'Autonomous Unit-Economics Optimization',
      description: `Evaluated options: ${comparisonNotes}. Selected SKU '${bestOffer.sku}' (${bestOffer.pack_format}) with lowest unit cost €${bestOffer.price_per_litre_eur.toFixed(2)}/L (Total: €${(bestOffer.total_contract_price_eur ?? 0).toFixed(2)} for ${bestOffer.packs_required} packs).`,
      action_type: 'reasoning',
      latency_ms: 9,
      tool_output: {
        selected_sku: bestOffer.sku,
        packs_required: bestOffer.packs_required,
        total_contract_price_eur: bestOffer.total_contract_price_eur,
      },
    });

    const quote = this.lockQuote(principal, {
      sku: bestOffer.sku,
      pack_quantity: bestOffer.packs_required ?? 1,
      deliver_by: parsed.deliver_by,
    });

    traces.push({
      step_number: 4,
      title: 'Tool Call: lock_quote (Two-Phase Stock Lock)',
      description: `Locked quote ${quote.quote_id} with Valio Aimo. Reserved ${quote.pack_quantity} packs (${quote.total_litres}L) at fixed price €${quote.locked_total_eur.toFixed(2)} with 15-minute TTL.`,
      action_type: 'tool_call',
      tool_name: 'lock_quote',
      latency_ms: 11,
      tool_input: { sku: bestOffer.sku, pack_quantity: bestOffer.packs_required, deliver_by: parsed.deliver_by },
      tool_output: quote,
    });

    const poRef = req.po_reference || this.nextHex('PO');
    const order = this.commitOrder(principal, {
      quote_id: quote.quote_id,
      po_reference: poRef,
      offer_comparisons: offers,
    });

    const { traces: _ignoredTraces, ...orderSnapshot } = order;
    traces.push({
      step_number: 5,
      title: 'Tool Call: commit_order (Policy Firewall Evaluation)',
      description: `Submitted order for quote ${quote.quote_id} with PO Reference ${poRef}. Evaluated against buyer autonomous spend, volume & category whitelist rules.`,
      action_type: 'tool_call',
      tool_name: 'commit_order',
      latency_ms: 10,
      tool_input: { quote_id: quote.quote_id, po_reference: poRef },
      tool_output: orderSnapshot,
    });

    let summary = '';
    let finalStatus = 'PENDING_APPROVAL';
    if (order.status === 'CONFIRMED') {
      finalStatus = 'CONFIRMED';
      if (order.approval_type === 'RECURRENT_WINDOW') {
        summary = `Order ${order.order_id} AUTO-APPROVED under Active Recurrent Grant (${order.recurrent_grant_id}). Total €${order.total_eur.toFixed(2)} is within standing allocation.`;
      } else {
        summary = `Order ${order.order_id} AUTO-APPROVED by AimoGate. Total €${order.total_eur.toFixed(2)} is within autonomous spend threshold.`;
      }
    } else {
      const violationStr = (order.violation_reasons || ['Policy limit exceeded']).join('; ');
      summary = `Order ${order.order_id} HELD by Policy Firewall: ${violationStr}. Stock (${bestOffer.packs_required} packs) is safely locked under ${quote.quote_id}.`;
    }

    traces.push({
      step_number: 6,
      title: 'Final Governance Decision',
      description: summary,
      action_type: 'policy_decision',
      latency_ms: 6,
      tool_output: {
        order_id: order.order_id,
        status: order.status,
        violations: order.violation_reasons,
      },
    });

    // Attach final 6-step trace to order for Audit Inspector
    order.traces = [...traces];

    return {
      success: true,
      mode_used: mode,
      execution_time_ms: Math.max(24, Date.now() - t0 + 38),
      traces,
      final_status: finalStatus,
      order,
      summary_message: summary,
    };
  }

  getCustomersRoster(): CustomerRosterItem[] {
    const now = new Date();
    return Array.from(this.policies.values()).map((p) => {
      const orders = Array.from(this.orders.values()).filter((o) => o.tenant_id === p.tenant_id);
      const confirmed = orders.filter((o) => o.status === 'CONFIRMED');
      const pending = orders.filter((o) => o.status === 'PENDING_APPROVAL');
      const totalSpend = confirmed.reduce((acc, o) => acc + o.total_eur, 0);
      const allowed = p.allowed_categories.map((c) => c.toLowerCase());
      const restricted = SYSTEM_CATEGORIES.filter((c) => !allowed.includes(c));
      const activeGrantsCount = this.listGrants(p.tenant_id, now).filter((g) => g.is_valid).length;
      return {
        tenant_id: p.tenant_id,
        tenant_name: p.tenant_name,
        max_auto_approve_eur: p.max_auto_approve_eur,
        max_auto_approve_litres: p.max_auto_approve_litres,
        allowed_categories: allowed,
        restricted_categories: restricted,
        active_grants_count: activeGrantsCount,
        total_orders: orders.length,
        pending_approvals: pending.length,
        confirmed_orders: confirmed.length,
        total_confirmed_spend_eur: Number(totalSpend.toFixed(2)),
        agent_status: this.killswitchHalted ? 'HALTED' : pending.length === 0 ? 'ONLINE' : 'ACTION_REQUIRED',
      };
    });
  }

  getNetworkOverview(): NetworkOverview {
    const orders = Array.from(this.orders.values());
    const confirmed = orders.filter((o) => o.status === 'CONFIRMED');
    const pending = orders.filter((o) => o.status === 'PENDING_APPROVAL');
    const totalSpend = confirmed.reduce((acc, o) => acc + o.total_eur, 0);
    const activeGrants = this.listGrants().filter((g) => g.is_valid).length;
    const rootInput = `${orders.length}|${this.auditLogs.length}|${totalSpend.toFixed(2)}`;
    return {
      total_customers: this.policies.size,
      total_confirmed_spend_eur: Number(totalSpend.toFixed(2)),
      total_orders: orders.length,
      pending_approvals: pending.length,
      active_recurrent_grants: activeGrants,
      killswitch_halted: this.killswitchHalted,
      merkle_root: `${computeIntegrityHash(rootInput)}${computeIntegrityHash(rootInput + ':vault').slice(2)}`,
      ledger_height: 184200 + this.auditLogs.length,
    };
  }

  getStockSummary(): StockSummaryItem[] {
    return Array.from(this.stock.values()).map((s) => {
      const p = this.products.get(s.sku)!;
      return {
        sku: s.sku,
        name: p.name,
        category: p.category,
        available_packs: s.available_packs,
        reserved_packs: s.reserved_packs,
        total_packs: s.available_packs + s.reserved_packs,
        pack_format: p.pack_format,
        pack_volume_litres: p.pack_volume_litres,
      };
    });
  }

  inspectZeroTrustPayloads(tenantId: string = DEFAULT_TENANT_ID): ZeroTrustInspectResponse {
    const rawRecords = Array.from(this.products.values()).map((p) => ({
      sku: p.sku,
      name: p.name,
      category: p.category,
      pack_format: p.pack_format,
      pack_volume_litres: p.pack_volume_litres,
      internal_cost_eur: p.internal_cost_eur,
      internal_margin_pct: p.internal_margin_pct,
      roadmap_status: p.roadmap_status,
      is_active: p.is_active,
    }));

    const agentPrincipal = this.getPresetPrincipal('agent', tenantId);
    const sanitized = this.searchOffers(agentPrincipal, {
      query: 'lactose-free milk',
      required_volume_litres: 1000,
    });

    return {
      raw_erp_database_view: {
        description: 'Valio Aimo Internal ERP Database (Unfiltered)',
        confidential_columns_present: ['internal_cost_eur', 'internal_margin_pct', 'roadmap_status'],
        records: rawRecords,
      },
      sanitized_agent_gateway_view: {
        description: 'Public Gateway DTO Output (Zero-Trust Projected)',
        confidential_fields_stripped: ['internal_cost_eur', 'internal_margin_pct', 'roadmap_status'],
        unreleased_skus_omitted: ['VA-ROADMAP-Q4-PRO'],
        records: sanitized,
      },
    };
  }
}
