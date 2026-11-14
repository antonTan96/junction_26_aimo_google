export const DEFAULT_TENANT_ID = 'hotel_nordic_group';

export type PrincipalType = 'agent' | 'human' | 'admin';

export interface Principal {
  tenant_id: string;
  principal_id: string;
  principal_type: PrincipalType;
  scopes: string[];
}

export interface Product {
  sku: string;
  name: string;
  category: string;
  dietary_tags: string[];
  pack_format: string;
  pack_volume_litres: number;
  min_lead_time_hours: number;
  is_active: boolean;
  internal_cost_eur: number;
  internal_margin_pct: number;
  roadmap_status: 'LIVE' | 'UNRELEASED';
}

export interface WarehouseStock {
  sku: string;
  available_packs: number;
  reserved_packs: number;
}

export type CategoryTimeWindow = 'weekly' | 'daily' | 'monthly' | 'none';

export interface CategoryRule {
  category: string;
  time_window: CategoryTimeWindow;
  max_storage_litres: number;
  rule_valid_until: string | null;
}

export interface CategoryRuleUsageDTO extends CategoryRule {
  current_period_consumed_litres: number;
  is_expired: boolean;
  days_remaining: number | null;
}

export interface SubstitutionRule {
  id: string;
  tenant_id: string;
  original_sku: string;
  original_name?: string;
  substitute_sku: string;
  substitute_name?: string;
  auto_approved: boolean;
  max_price_increase_pct?: number;
  created_at: string;
  created_by?: string;
}

export interface SubstitutionRequestDTO {
  request_id: string;
  order_id?: string;
  tenant_id: string;
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED';
  original_sku: string;
  original_name: string;
  requested_packs: number;
  available_packs: number;
  unit_contract_price_eur: number;
  original_total_eur: number;
  substitute_sku: string;
  substitute_name: string;
  substitute_packs: number;
  substitute_unit_price_eur: number;
  substitute_total_eur: number;
  price_difference_eur: number;
  price_difference_pct: number;
  reason: string;
  created_at: string;
  decided_at?: string | null;
  decided_by?: string | null;
}

export interface TenantPolicy {
  tenant_id: string;
  tenant_name: string;
  max_auto_approve_eur: number;
  max_auto_approve_litres: number;
  allowed_categories: string[];
  category_rules?: Record<string, CategoryRule>;
  substitution_rules?: Record<string, SubstitutionRule>;
  anomaly_sensitivity_pct: number;
  auto_dispute_enabled: boolean;
}

export interface QuoteLock {
  quote_id: string;
  tenant_id: string;
  sku: string;
  pack_quantity: number;
  total_litres: number;
  locked_total_eur: number;
  deliver_by: string;
  status: 'LOCKED' | 'CONSUMED' | 'RELEASED' | 'EXPIRED';
  expires_at: string;
  created_at: string;
}

export type OrderStatus = 'CONFIRMED' | 'PENDING_APPROVAL' | 'REJECTED';
export type ApprovalType = 'AUTO' | 'ONE_TIME' | 'RECURRENT_WINDOW' | 'PENDING';

export interface OrderDTO {
  order_id: string;
  quote_id: string;
  tenant_id: string;
  tenant_name?: string;
  po_reference: string;
  status: OrderStatus;
  total_eur: number;
  violation_reasons: string[] | null;
  approved_by: string | null;
  approval_type: ApprovalType;
  recurrent_grant_id: string | null;
  created_at: string;
  sku: string | null;
  product_name?: string | null;
  category?: string | null;
  pack_quantity: number | null;
  total_litres: number | null;
  verification_hash?: string;
  traces?: AgentStepTrace[] | null;
  offer_comparisons?: PublicOfferDTO[] | null;
  items?: OrderItemDTO[] | null;
  recipe_name?: string | null;
  substitution_request?: SubstitutionRequestDTO | null;
}

export type ProcurementRequestType = 'single_item' | 'multi_item' | 'recipe';

export interface DecomposedIngredient {
  ingredient_name: string;
  search_query: string;
  quantity: number;
  unit: string;
  category_hint: string;
  dietary_tags: string[];
  importance: 'essential' | 'optional' | 'substitute';
  culinary_role?: string;
}

export interface RecipeMetadata {
  name: string;
  servings_or_yield?: number;
  yield_unit?: string;
  cuisine?: string;
  description?: string;
}

export interface PreprocessedPromptResult {
  raw_prompt: string;
  request_type: ProcurementRequestType;
  recipe?: RecipeMetadata;
  dietary_tags: string[];
  urgency?: 'normal' | 'urgent' | 'asap';
  deliver_by: string;
  notes?: string;
  items: DecomposedIngredient[];
}

export interface OrderItemDTO {
  sku: string;
  product_name: string;
  category: string;
  dietary_tags?: string[];
  pack_format: string;
  pack_quantity: number;
  delivered_volume: number;
  unit_price_eur: number;
  total_price_eur: number;
  deduced_from_ingredient?: string;
}

export interface RecurrentApprovalGrant {
  grant_id: string;
  tenant_id: string;
  category: string;
  sku: string | null;
  frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY';
  window_days: number;
  max_budget_per_period_eur: number;
  current_period_spent_eur: number;
  valid_from: string;
  valid_until: string;
  status: 'ACTIVE' | 'EXPIRED' | 'REVOKED';
  approved_by: string;
  notes: string | null;
  period_start?: string | Date;
  created_at: string;
  is_valid: boolean;
  days_remaining: number;
}

export interface ScheduledPrompt {
  schedule_id: string;
  tenant_id: string;
  name: string;
  executor_agent: string;
  prompt: string;
  strategy: 'cron' | 'threshold' | 'one-time';
  cron_expr: string;
  next_run_label: string;
  max_cap_eur: number;
  require_multi_vendor: boolean;
  status: 'ACTIVE' | 'NEEDS_SIGNOFF' | 'PAUSED';
  last_run_summary: string;
  created_at: string;
}

export interface AuditLogEntry {
  id: number;
  timestamp: string;
  tenant_id: string;
  tenant_name?: string;
  actor_type: string;
  actor_id: string;
  action: string;
  payload_summary: Record<string, unknown>;
  verification_hash?: string;
}

export interface PublicOfferDTO {
  sku: string;
  name: string;
  category: string;
  dietary_tags: string[];
  pack_format: string;
  pack_volume_litres: number;
  unit_contract_price_eur: number;
  price_per_litre_eur: number;
  packs_required: number | null;
  delivered_volume_litres: number | null;
  total_contract_price_eur: number | null;
  is_stock_available: boolean;
  available_packs: number;
  lead_time_feasible: boolean;
  earliest_delivery: string;
}

export interface AgentStepTrace {
  step_number: number;
  title: string;
  description: string;
  action_type: 'reasoning' | 'tool_call' | 'policy_decision';
  tool_name?: string;
  latency_ms?: number;
  tool_input?: unknown;
  tool_output?: unknown;
}

export interface AgentRunResponse {
  success: boolean;
  mode_used: string;
  execution_time_ms: number;
  traces: AgentStepTrace[];
  final_status: string;
  order?: OrderDTO | null;
  summary_message: string;
  preprocessed_prompt?: PreprocessedPromptResult;
}

export interface CustomerRosterItem {
  tenant_id: string;
  tenant_name: string;
  max_auto_approve_eur: number;
  max_auto_approve_litres: number;
  allowed_categories: string[];
  restricted_categories: string[];
  active_grants_count: number;
  total_orders: number;
  pending_approvals: number;
  confirmed_orders: number;
  total_confirmed_spend_eur: number;
  agent_status: 'ONLINE' | 'ACTION_REQUIRED' | 'HALTED';
}

export interface GuardrailWhitelistDTO {
  tenant_id: string;
  tenant_name: string;
  allowed_categories: string[];
  all_system_categories: string[];
  restricted_categories: string[];
  max_auto_approve_eur: number;
  active_grants_count: number;
  category_rules?: Record<string, CategoryRule>;
  category_usage?: Record<string, CategoryRuleUsageDTO>;
}

export interface StockSummaryItem {
  sku: string;
  name: string;
  category: string;
  available_packs: number;
  reserved_packs: number;
  total_packs: number;
  pack_format: string;
  pack_volume_litres: number;
}

export interface ZeroTrustInspectResponse {
  raw_erp_database_view: {
    description: string;
    confidential_columns_present: string[];
    records: Array<{
      sku: string;
      name: string;
      category: string;
      pack_format: string;
      pack_volume_litres: number;
      internal_cost_eur: number;
      internal_margin_pct: number;
      roadmap_status: string;
      is_active: boolean;
    }>;
  };
  sanitized_agent_gateway_view: {
    description: string;
    confidential_fields_stripped: string[];
    unreleased_skus_omitted: string[];
    records: PublicOfferDTO[];
  };
}

export interface TokenBundle {
  agent: {
    token: string;
    principal_type: 'agent';
    principal_id: string;
    scopes: string[];
    description: string;
  };
  human: {
    token: string;
    principal_type: 'human';
    principal_id: string;
    scopes: string[];
    description: string;
  };
  admin: {
    token: string;
    principal_type: 'admin';
    principal_id: string;
    scopes: string[];
    description: string;
  };
}

export interface NetworkOverview {
  total_customers: number;
  total_confirmed_spend_eur: number;
  total_orders: number;
  pending_approvals: number;
  active_recurrent_grants: number;
  killswitch_halted: boolean;
  merkle_root: string;
  ledger_height: number;
}

export type NavSectionId =
  | 'procurement-guardrails'
  | 'autonomous-prompt-scheduler'
  | 'safety-and-budget-limits'
  | 'audit-and-agent-logs';

export interface CatalogProduct {
  id: string;
  gtin: string;
  name_fi: string;
  name_en: string;
  name_sv: string;
  display_name: string;
  vendor_name: string;
  brand: string;
  category: string;
  dietary_tags: string[];
  pack_format: string;
  pack_volume_litres: number;
  temperature_condition: number;
  search_corpus: string;
  is_active: boolean;
  base_price_eur?: number;
}
