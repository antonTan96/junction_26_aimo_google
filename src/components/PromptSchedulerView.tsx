import React, { useEffect, useState } from 'react';
import {
  ShoppingBag,
  Gavel,
  CalendarClock,
  Repeat,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  PackageCheck,
  Search,
  Sparkles,
  Filter,
  ArrowRight,
  Tag,
  Plus,
  Loader2,
  Utensils,
  ChefHat,
  Layers,
} from 'lucide-react';
import type {
  AgentRunResponse,
  CatalogProduct,
  CustomerRosterItem,
  OrderDTO,
  RecurrentApprovalGrant,
  ScheduledPrompt,
  StockSummaryItem,
  TenantPolicy,
} from '../types/aimogate';

interface PromptSchedulerViewProps {
  customers: CustomerRosterItem[];
  selectedTenant: string;
  onTenantChange?: (tenantId: string) => void;
  policy: TenantPolicy;
  pendingOrders: OrderDTO[];
  recurrentGrants: RecurrentApprovalGrant[];
  scheduledPrompts: ScheduledPrompt[];
  stock: StockSummaryItem[];
  agentResponse: AgentRunResponse | null;
  isRunningAgent: boolean;
  onRunAgent: (prompt: string, mode: string) => void;
  onDeploySchedule: (payload: {
    name: string;
    prompt: string;
    strategy: 'cron' | 'threshold' | 'one-time';
    cron_expr: string;
    max_cap_eur: number;
    require_multi_vendor: boolean;
  }) => void;
  onApproveOrder: (
    orderId: string,
    approvalType: 'ONE_TIME' | 'RECURRENT_WINDOW',
    windowDays: number,
    budget: number
  ) => void;
  onRejectOrder: (orderId: string) => void;
  onRevokeGrant: (grantId: string) => void;
}

const SCENARIO_PRESETS = [
  {
    label: '1,000 GF Licorice Cookies',
    note: 'Culinary Recipe & Scaling',
    prompt:
      'I need ingredients for 1,000 gluten-free licorice cookies for a wedding event next Thursday.',
  },
  {
    label: 'Salmon Soup for 50',
    note: 'Nordic Lohikeitto Recipe',
    prompt:
      'Salmon soup for 50 people by Friday morning. Find an option based on price and availability.',
  },
  {
    label: '50L Milk & 10kg Butter',
    note: 'Multi-Item Order',
    prompt:
      'We need 50 liters of organic whole milk and 10kg butter for the bakery.',
  },
  {
    label: '1,000L Milk (€1,180)',
    note: 'Over limit — needs sign-off',
    prompt:
      'I need 1,000 litres of lactose-free milk by Monday. Find an option that meets our requirements based on price and availability.',
  },
  {
    label: '400L Milk (€472)',
    note: 'Within limit — auto-approves',
    prompt:
      'I need 400 litres of lactose-free milk by Monday. Find an option that meets our requirements based on price and availability.',
  },
  {
    label: '20kg Cooking Butter',
    note: 'Valio Voi staple',
    prompt:
      'We need 20kg of traditional cooking butter by Friday. Find an option based on price and availability.',
  },
  {
    label: '10kg Espresso Beans',
    note: 'Paulig coffee beans',
    prompt:
      'Purchase 10kg of Paulig espresso coffee beans for the cafeteria by Monday.',
  },
  {
    label: '200L Barista Oat Drink',
    note: 'Plant-based dairy',
    prompt:
      'I need 200 litres of barista oat drink by Monday. Find an option based on price and availability.',
  },
  {
    label: '20 Boxes Croissants',
    note: 'Bakery category',
    prompt:
      'I need 20 boxes of artisanal butter croissants by Monday. Find an option based on price and availability.',
  },
];

const FRIENDLY_SCHEDULES = [
  { label: 'Twice a week (Tue & Fri, 02:00)', cron: '0 2 * * 2,5' },
  { label: 'Every Monday morning (06:00)', cron: '0 6 * * 1' },
  { label: 'Every morning (05:00)', cron: '0 5 * * *' },
];

export const PromptSchedulerView: React.FC<PromptSchedulerViewProps> = ({
  customers,
  selectedTenant,
  onTenantChange,
  policy,
  pendingOrders,
  recurrentGrants,
  scheduledPrompts,
  stock,
  agentResponse,
  isRunningAgent,
  onRunAgent,
  onDeploySchedule,
  onApproveOrder,
  onRejectOrder,
  onRevokeGrant,
}) => {
  const [workflowName, setWorkflowName] = useState('Monday Milk Delivery');
  const [prompt, setPrompt] = useState(SCENARIO_PRESETS[0].prompt);
  const [strategy, setStrategy] = useState<'one-time' | 'cron' | 'threshold'>('one-time');
  const [cronExpr, setCronExpr] = useState('0 2 * * 2,5');
  const [approvalWindowDays, setApprovalWindowDays] = useState(7);
  const [recurrentBudget, setRecurrentBudget] = useState(3000);
  const [showWindowOptions, setShowWindowOptions] = useState(false);
  const [showTraceDetails, setShowTraceDetails] = useState(false);

  // Catalog Explorer & RAG Search state
  const [catalogSearch, setCatalogSearch] = useState('');
  const [catalogCategory, setCatalogCategory] = useState('all');
  const [catalogItems, setCatalogItems] = useState<CatalogProduct[]>([]);
  const [catalogTotal, setCatalogTotal] = useState(17546);
  const [catalogBackend, setCatalogBackend] = useState<'mariadb' | 'in-memory-json'>('in-memory-json');
  const [isLoadingCatalog, setIsLoadingCatalog] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      setIsLoadingCatalog(true);
      try {
        const catParam = catalogCategory !== 'all' ? `&category=${catalogCategory}` : '';
        const qParam = catalogSearch ? `&q=${encodeURIComponent(catalogSearch)}` : '';
        const res = await fetch(`/api/v1/catalog/search?limit=12${catParam}${qParam}`);
        if (res.ok && !cancelled) {
          const data = await res.json();
          setCatalogItems(data.products || []);
          if (data.catalog_size) setCatalogTotal(data.catalog_size);
          if (data.backend) setCatalogBackend(data.backend);
        }
      } catch (err) {
        console.warn('Catalog search error:', err);
      } finally {
        if (!cancelled) setIsLoadingCatalog(false);
      }
    }, 200);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [catalogSearch, catalogCategory]);

  const currentCustomer = customers.find((c) => c.tenant_id === selectedTenant) || customers[0];

  const handleSaveRecurring = () => {
    onDeploySchedule({
      name: workflowName.trim() || 'Weekly Kitchen Restock',
      prompt,
      strategy,
      cron_expr: cronExpr,
      max_cap_eur: policy.max_auto_approve_eur,
      require_multi_vendor: true,
    });
  };

  return (
    <div className="w-full max-w-[1360px] mx-auto px-4 sm:px-8 py-8 flex flex-col gap-8">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div className="space-y-1.5 max-w-2xl">
          <h1 className="text-2xl lg:text-3xl font-semibold tracking-tight text-on-surface font-headline">
            Orders &amp; Approvals
          </h1>
          <p className="text-sm text-on-surface-variant">
            Request supplies from Valio Aimo in plain English, review orders waiting for your sign-off, or set up recurring deliveries.
          </p>
        </div>

        <div className="text-sm text-on-surface-variant tabular-nums shrink-0">
          Auto-approving up to{' '}
          <span className="text-on-surface font-semibold">
            €{policy.max_auto_approve_eur.toLocaleString()}
          </span>{' '}
          ·{' '}
          <span className="text-on-surface font-semibold">
            {policy.max_auto_approve_litres.toLocaleString()} L
          </span>
        </div>
      </div>

      {/* Main Two-Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left: Place an Order */}
        <div className="lg:col-span-7 flex flex-col gap-6">
          <div className="p-6 rounded-2xl bg-surface-container border border-outline-variant/50 space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <ShoppingBag className="w-5 h-5 text-primary shrink-0" />
                <h2 className="text-base font-semibold text-on-surface font-headline">
                  Place a Kitchen Order
                </h2>
              </div>
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-surface-container-high text-[11px] font-medium text-primary border border-primary/20">
                <Sparkles className="w-3.5 h-3.5" />
                <span>NVIDIA Nemotron 3.5 Super VL</span>
              </div>
            </div>

            {/* Delivery Destination */}
            <div className="space-y-1.5">
              <span className="text-xs font-medium text-on-surface-variant block">
                Deliver to
              </span>
              <div className="px-3.5 py-2.5 rounded-xl bg-surface-container-lowest border border-outline-variant/50 text-sm text-on-surface font-medium flex items-center justify-between">
                <span className="truncate">{currentCustomer?.tenant_name || 'Nordic Crown Hotels (Helsinki)'}</span>
                <span className="text-xs text-on-surface-variant shrink-0 ml-2">
                  Auto-limit €{policy.max_auto_approve_eur.toLocaleString()}
                </span>
              </div>
            </div>

            {/* Quick Order Examples */}
            <div className="space-y-2">
              <span className="text-xs font-medium text-on-surface-variant block">
                Quick examples
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {SCENARIO_PRESETS.map((preset) => {
                  const selected = prompt === preset.prompt;
                  return (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => setPrompt(preset.prompt)}
                      className={`p-3 rounded-xl border text-left transition-colors cursor-pointer ${
                        selected
                          ? 'bg-surface-container-high border-primary/50 text-on-surface'
                          : 'bg-surface-container-lowest border-outline-variant/40 text-on-surface-variant hover:text-on-surface hover:border-outline-variant'
                      }`}
                    >
                      <div className="text-sm font-medium text-on-surface">{preset.label}</div>
                      <div className="text-xs text-on-surface-variant mt-0.5">{preset.note}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Plain English Request */}
            <div className="space-y-2">
              <label
                htmlFor="nl-directive-textarea"
                className="text-xs font-medium text-on-surface-variant block"
              >
                What does your kitchen need?
              </label>
              <textarea
                id="nl-directive-textarea"
                rows={3}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="e.g. I need 1,000 litres of lactose-free milk by Monday..."
                className="w-full rounded-xl border border-outline-variant/50 bg-surface-container-lowest p-3.5 text-sm leading-relaxed text-on-surface focus:outline-none focus:border-primary/50"
              />
            </div>

            {/* Order Timing */}
            <div className="space-y-3">
              <span className="text-xs font-medium text-on-surface-variant block">
                How often should this run?
              </span>
              <div className="grid grid-cols-3 gap-1.5 p-1 rounded-xl bg-surface-container-lowest border border-outline-variant/40">
                <button
                  type="button"
                  onClick={() => setStrategy('one-time')}
                  className={`py-2 px-2 text-xs sm:text-sm font-medium rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
                    strategy === 'one-time'
                      ? 'bg-surface-container-high text-on-surface'
                      : 'text-on-surface-variant hover:text-on-surface'
                  }`}
                >
                  Just Once
                </button>
                <button
                  type="button"
                  onClick={() => setStrategy('cron')}
                  className={`py-2 px-2 text-xs sm:text-sm font-medium rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
                    strategy === 'cron'
                      ? 'bg-surface-container-high text-on-surface'
                      : 'text-on-surface-variant hover:text-on-surface'
                  }`}
                >
                  Repeat Weekly
                </button>
                <button
                  type="button"
                  onClick={() => setStrategy('threshold')}
                  className={`py-2 px-2 text-xs sm:text-sm font-medium rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
                    strategy === 'threshold'
                      ? 'bg-surface-container-high text-on-surface'
                      : 'text-on-surface-variant hover:text-on-surface'
                  }`}
                >
                  When Stock Low
                </button>
              </div>

              {strategy !== 'one-time' && (
                <div className="p-4 rounded-xl bg-surface-container-lowest border border-outline-variant/40 space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label
                        htmlFor="workflow-id-input"
                        className="text-xs text-on-surface-variant block"
                      >
                        Schedule name
                      </label>
                      <input
                        id="workflow-id-input"
                        type="text"
                        value={workflowName}
                        onChange={(e) => setWorkflowName(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg bg-surface-container border border-outline-variant/50 text-sm text-on-surface focus:outline-none focus:border-primary/50"
                      />
                    </div>
                    {strategy === 'cron' && (
                      <div className="space-y-1">
                        <label
                          htmlFor="schedule-frequency-select"
                          className="text-xs text-on-surface-variant block"
                        >
                          Delivery schedule
                        </label>
                        <select
                          id="schedule-frequency-select"
                          value={cronExpr}
                          onChange={(e) => setCronExpr(e.target.value)}
                          className="w-full px-3 py-2 rounded-lg bg-surface-container border border-outline-variant/50 text-sm text-on-surface focus:outline-none focus:border-primary/50 cursor-pointer"
                        >
                          {FRIENDLY_SCHEDULES.map((item) => (
                            <option key={item.cron} value={item.cron}>
                              {item.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={handleSaveRecurring}
                      className="px-4 py-2 rounded-lg bg-surface-container-high hover:bg-surface-container-highest text-sm font-medium text-primary transition-colors whitespace-nowrap cursor-pointer"
                    >
                      Save Recurring Order
                    </button>
                  </div>
                </div>
              )}
            </div>

            <button
              type="button"
              disabled={isRunningAgent || !prompt.trim()}
              onClick={() => onRunAgent(prompt, 'deterministic')}
              className="w-full py-3 px-4 rounded-xl bg-primary hover:bg-primary-fixed text-on-primary font-semibold text-sm transition-colors cursor-pointer disabled:opacity-50"
            >
              {isRunningAgent ? 'Checking Valio Aimo Stock & Prices...' : 'Place Order'}
            </button>
          </div>

          {/* Clean Order Result Summary */}
          {agentResponse && (
            <div className="p-6 rounded-2xl bg-surface-container border border-outline-variant/60 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  {agentResponse.final_status === 'CONFIRMED' ? (
                    <CheckCircle2 className="w-5 h-5 text-primary shrink-0" />
                  ) : (
                    <AlertTriangle className="w-5 h-5 text-error shrink-0" />
                  )}
                  <h3 className="text-base font-semibold text-on-surface font-headline">
                    {agentResponse.final_status === 'CONFIRMED'
                      ? 'Order Confirmed Automatically'
                      : 'Order Held for Your Approval'}
                  </h3>
                </div>
                {agentResponse.order && (
                  <span className="text-sm font-semibold text-on-surface tabular-nums">
                    €{agentResponse.order.total_eur.toFixed(2)}
                  </span>
                )}
              </div>

              <p className="text-sm text-on-surface-variant leading-relaxed">
                {agentResponse.summary_message
                  .replace(/HELD by Policy Firewall:/i, 'Held for your review:')
                  .replace(/autonomous limit/gi, 'automatic limit')}
              </p>

              {/* Recipe & Preprocessed Prompt Metadata Badge */}
              {agentResponse.preprocessed_prompt && agentResponse.preprocessed_prompt.request_type === 'recipe' && (
                <div className="flex flex-wrap items-center gap-2 p-2.5 rounded-xl bg-surface-container-high/60 border border-outline-variant/40 text-xs">
                  <ChefHat className="w-4 h-4 text-primary shrink-0" />
                  <span className="font-semibold text-on-surface font-headline">
                    {agentResponse.preprocessed_prompt.recipe?.name || agentResponse.order?.recipe_name || 'Recipe'}
                  </span>
                  {agentResponse.preprocessed_prompt.recipe?.servings_or_yield && (
                    <span className="px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
                      Yield: {agentResponse.preprocessed_prompt.recipe.servings_or_yield} {agentResponse.preprocessed_prompt.recipe.yield_unit || 'servings'}
                    </span>
                  )}
                  {agentResponse.preprocessed_prompt.recipe?.cuisine && (
                    <span className="text-on-surface-variant text-[11px]">
                      &bull; {agentResponse.preprocessed_prompt.recipe.cuisine}
                    </span>
                  )}
                  {agentResponse.preprocessed_prompt.dietary_tags?.map((t) => (
                    <span
                      key={t}
                      className="px-2 py-0.5 rounded-full bg-secondary-container text-on-secondary-container uppercase text-[10px] tracking-wide font-medium"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              )}

              {/* Multi-Item / Recipe Line Items Breakdown */}
              {agentResponse.order?.items && agentResponse.order.items.length > 0 ? (
                <div className="pt-2 border-t border-outline-variant/40 space-y-2">
                  <div className="flex items-center justify-between text-xs font-semibold text-on-surface">
                    <span className="flex items-center gap-1.5">
                      <Layers className="w-3.5 h-3.5 text-primary" />
                      {agentResponse.order.items.length > 1
                        ? `Procurement Breakdown (${agentResponse.order.items.length} Line Items)`
                        : 'Procured Catalog Item'}
                    </span>
                    <span className="text-[11px] text-on-surface-variant font-normal">
                      Valio Aimo Contract Sourcing
                    </span>
                  </div>
                  <div className="divide-y divide-outline-variant/20 rounded-xl bg-surface-container-low/70 border border-outline-variant/30 overflow-hidden text-xs">
                    {agentResponse.order.items.map((item, idx) => (
                      <div key={`${item.sku}-${idx}`} className="p-3 flex items-center justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-on-surface truncate">{item.product_name}</span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-container-highest text-on-surface-variant uppercase font-mono">
                              {item.category}
                            </span>
                          </div>
                          {item.deduced_from_ingredient && (
                            <div className="text-[11px] text-on-surface-variant flex items-center gap-1 mt-0.5">
                              <span className="text-primary font-medium">Deduced:</span>
                              <span>{item.deduced_from_ingredient}</span>
                            </div>
                          )}
                        </div>
                        <div className="text-right shrink-0">
                          <div className="font-semibold text-on-surface tabular-nums">
                            €{item.total_price_eur.toFixed(2)}
                          </div>
                          <div className="text-[10px] text-on-surface-variant tabular-nums">
                            {item.pack_quantity} packs &middot; €{item.unit_price_eur.toFixed(2)}/pack
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : agentResponse.order ? (
                <div className="grid grid-cols-3 gap-3 pt-2 border-t border-outline-variant/40 text-xs tabular-nums">
                  <div>
                    <div className="text-on-surface-variant">Item</div>
                    <div className="text-on-surface font-medium truncate mt-0.5">
                      {agentResponse.order.product_name || agentResponse.order.sku}
                    </div>
                  </div>
                  <div>
                    <div className="text-on-surface-variant">Quantity</div>
                    <div className="text-on-surface font-medium mt-0.5">
                      {agentResponse.order.pack_quantity} boxes ({agentResponse.order.total_litres} L)
                    </div>
                  </div>
                  <div>
                    <div className="text-on-surface-variant">Status</div>
                    <div
                      className={`font-medium mt-0.5 ${
                        agentResponse.final_status === 'CONFIRMED' ? 'text-primary' : 'text-error'
                      }`}
                    >
                      {agentResponse.final_status === 'CONFIRMED'
                        ? 'Confirmed'
                        : 'Waiting for sign-off'}
                    </div>
                  </div>
                </div>
              ) : null}

              <div className="pt-1">
                <button
                  type="button"
                  onClick={() => setShowTraceDetails((prev) => !prev)}
                  className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline cursor-pointer"
                >
                  {showTraceDetails ? (
                    <ChevronDown className="w-4 h-4" />
                  ) : (
                    <ChevronRight className="w-4 h-4" />
                  )}
                  <span>
                    {showTraceDetails ? 'Hide step-by-step details' : 'Show step-by-step details'}
                  </span>
                </button>
              </div>

              {showTraceDetails && (
                <div className="pt-2 border-t border-outline-variant/40 space-y-3">
                  {agentResponse.traces.map((step) => (
                    <div key={step.step_number} className="text-xs space-y-0.5">
                      <div className="font-medium text-on-surface">
                        {step.step_number}. {step.title}
                      </div>
                      <p className="text-on-surface-variant">{step.description}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right: Waiting for Approval + Recurring & Stock */}
        <div className="lg:col-span-5 flex flex-col gap-6">
          {/* Needs Your Approval */}
          <div className="p-6 rounded-2xl bg-surface-container border border-outline-variant/50 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <Gavel className="w-5 h-5 text-error shrink-0" />
                <h2 className="text-base font-semibold text-on-surface font-headline">
                  Needs Your Approval
                </h2>
              </div>
              <span className="text-xs font-medium text-on-surface-variant tabular-nums">
                {pendingOrders.length} waiting
              </span>
            </div>

            {pendingOrders.length === 0 ? (
              <div className="py-3 flex items-start gap-2.5 text-sm text-on-surface-variant">
                <CheckCircle2 className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                <span>
                  All caught up. Orders over €{policy.max_auto_approve_eur.toLocaleString()} or outside allowed categories will appear here for one-click approval.
                </span>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="divide-y divide-outline-variant/40">
                  {pendingOrders.map((ord) => (
                    <div key={ord.order_id} className="py-4 first:pt-0 last:pb-0 space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-1 min-w-0">
                          <div className="text-sm font-semibold text-on-surface">
                            {ord.product_name || ord.sku}
                          </div>
                          <div className="text-xs text-on-surface-variant tabular-nums">
                            {ord.pack_quantity} boxes ({ord.total_litres} L) · Stock held for 15 min
                          </div>
                          {ord.violation_reasons && ord.violation_reasons.length > 0 && (
                            <p className="text-xs text-error">
                              {ord.violation_reasons
                                .join(' · ')
                                .replace(/autonomous limit/gi, 'automatic limit')}
                            </p>
                          )}
                        </div>
                        <span className="text-base font-semibold text-on-surface tabular-nums shrink-0">
                          €{ord.total_eur.toFixed(2)}
                        </span>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            onApproveOrder(
                              ord.order_id,
                              'ONE_TIME',
                              approvalWindowDays,
                              recurrentBudget
                            )
                          }
                          className="flex-1 px-3 py-2 rounded-lg bg-primary text-on-primary text-xs font-semibold hover:bg-primary-fixed transition-colors whitespace-nowrap cursor-pointer"
                        >
                          Approve Once
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            onApproveOrder(
                              ord.order_id,
                              'RECURRENT_WINDOW',
                              approvalWindowDays,
                              recurrentBudget
                            )
                          }
                          className="flex-1 px-3 py-2 rounded-lg bg-surface-container-high border border-outline-variant/60 text-on-surface text-xs font-medium hover:bg-surface-container-highest transition-colors whitespace-nowrap cursor-pointer"
                        >
                          Approve for {approvalWindowDays} Days
                        </button>
                        <button
                          type="button"
                          onClick={() => onRejectOrder(ord.order_id)}
                          className="px-3 py-2 rounded-lg bg-error-container text-error text-xs font-medium hover:opacity-90 transition-opacity inline-flex items-center gap-1 whitespace-nowrap cursor-pointer"
                        >
                          <XCircle className="w-3.5 h-3.5" />
                          <span>Decline</span>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="pt-2 border-t border-outline-variant/40">
                  <button
                    type="button"
                    onClick={() => setShowWindowOptions((v) => !v)}
                    className="text-xs text-on-surface-variant hover:text-primary cursor-pointer"
                  >
                    {showWindowOptions
                      ? 'Hide multi-day approval settings'
                      : `Multi-day approval window: ${approvalWindowDays} days · €${recurrentBudget.toLocaleString()} budget (Edit)`}
                  </button>

                  {showWindowOptions && (
                    <div className="grid grid-cols-2 gap-3 mt-3 text-xs">
                      <label className="space-y-1 block">
                        <span className="text-on-surface-variant block">Days to pre-approve</span>
                        <input
                          type="number"
                          min={1}
                          max={90}
                          value={approvalWindowDays}
                          onChange={(e) => setApprovalWindowDays(Number(e.target.value) || 7)}
                          className="w-full px-2.5 py-1.5 rounded-lg bg-surface-container-lowest border border-outline-variant/50 text-on-surface tabular-nums"
                        />
                      </label>
                      <label className="space-y-1 block">
                        <span className="text-on-surface-variant block">Window budget (€)</span>
                        <input
                          type="number"
                          min={500}
                          step={100}
                          value={recurrentBudget}
                          onChange={(e) => setRecurrentBudget(Number(e.target.value) || 3000)}
                          className="w-full px-2.5 py-1.5 rounded-lg bg-surface-container-lowest border border-outline-variant/50 text-on-surface tabular-nums"
                        />
                      </label>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Pre-Approvals & Recurring Deliveries */}
          <div className="p-6 rounded-2xl bg-surface-container border border-outline-variant/50 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <Repeat className="w-5 h-5 text-primary shrink-0" />
                <h2 className="text-base font-semibold text-on-surface font-headline">
                  Recurring &amp; Pre-Approved
                </h2>
              </div>
              <span className="text-xs text-on-surface-variant tabular-nums">
                {scheduledPrompts.length + recurrentGrants.length} active
              </span>
            </div>

            {recurrentGrants.length === 0 && scheduledPrompts.length === 0 ? (
              <p className="text-xs text-on-surface-variant">
                No recurring deliveries or multi-day pre-approvals active yet.
              </p>
            ) : (
              <div className="divide-y divide-outline-variant/40">
                {recurrentGrants.map((grant) => (
                  <div key={grant.grant_id} className="py-3 first:pt-0 last:pb-0 space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-on-surface capitalize">
                        {grant.category} pre-approval
                      </span>
                      {grant.status === 'ACTIVE' && (
                        <button
                          type="button"
                          onClick={() => onRevokeGrant(grant.grant_id)}
                          className="text-xs text-error hover:underline cursor-pointer"
                        >
                          Stop
                        </button>
                      )}
                    </div>
                    <div className="flex items-center justify-between text-xs text-on-surface-variant tabular-nums">
                      <span>{grant.days_remaining} days left</span>
                      <span>
                        €{grant.current_period_spent_eur.toFixed(0)} of €
                        {grant.max_budget_per_period_eur.toFixed(0)} used
                      </span>
                    </div>
                  </div>
                ))}

                {scheduledPrompts.map((sch) => (
                  <div key={sch.schedule_id} className="py-3 first:pt-0 last:pb-0 space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <CalendarClock className="w-4 h-4 text-primary shrink-0" />
                        <span className="text-sm font-medium text-on-surface truncate">
                          {sch.name}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setPrompt(sch.prompt);
                          onRunAgent(sch.prompt, 'deterministic');
                        }}
                        className="px-2.5 py-1 rounded-lg bg-surface-container-high text-xs font-medium text-primary hover:bg-surface-container-highest transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        Order Now
                      </button>
                    </div>
                    <p className="text-xs text-on-surface-variant truncate">
                      {sch.next_run_label
                        .replace('Trigger: Inventory < 40 packs', 'Auto-orders when below 40 boxes')
                        .replace('Tue & Fri 02:00 UTC', 'Every Tuesday & Friday at 02:00')}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Valio Aimo Catalog & RAG Explorer */}
          <div className="p-6 rounded-2xl bg-surface-container border border-outline-variant/50 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <Sparkles className="w-5 h-5 text-primary shrink-0" />
                <h2 className="text-base font-semibold text-on-surface font-headline">
                  Valio Aimo Catalog &amp; RAG
                </h2>
              </div>
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-primary/10 text-primary border border-primary/20">
                  {catalogBackend === 'mariadb' ? 'MariaDB Active' : 'RAG Indexed'} · {catalogTotal.toLocaleString()} SKUs
                </span>
              </div>
            </div>

            <p className="text-xs text-on-surface-variant">
              Live retrieval over the official Junction 2026 Valio Aimo catalog. Click any item to ground your AI prompt.
            </p>

            {/* Search Input */}
            <div className="relative">
              <Search className="w-4 h-4 text-on-surface-variant absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={catalogSearch}
                onChange={(e) => setCatalogSearch(e.target.value)}
                placeholder="Search butter, lactose-free milk, coffee, croissants..."
                className="w-full pl-9 pr-8 py-2 rounded-xl bg-surface-container-lowest border border-outline-variant/50 text-xs text-on-surface placeholder:text-on-surface-variant/60 focus:outline-none focus:border-primary/50"
              />
              {catalogSearch && (
                <button
                  type="button"
                  onClick={() => setCatalogSearch('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-on-surface-variant hover:text-on-surface cursor-pointer"
                >
                  ✕
                </button>
              )}
            </div>

            {/* Category Filter Pills */}
            <div className="flex flex-wrap gap-1.5 pt-0.5">
              {[
                { id: 'all', label: 'All' },
                { id: 'dairy', label: 'Dairy' },
                { id: 'plant-based', label: 'Plant-Based' },
                { id: 'bakery', label: 'Bakery' },
                { id: 'beverages', label: 'Beverages' },
                { id: 'cleaning', label: 'Cleaning' },
                { id: 'meat', label: 'Meat' },
              ].map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setCatalogCategory(c.id)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                    catalogCategory === c.id
                      ? 'bg-primary text-on-primary'
                      : 'bg-surface-container-high text-on-surface-variant hover:text-on-surface'
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>

            {/* Catalog Items List */}
            {isLoadingCatalog ? (
              <div className="py-8 flex flex-col items-center justify-center gap-2 text-on-surface-variant text-xs">
                <Loader2 className="w-5 h-5 animate-spin text-primary" />
                <span>Searching catalog...</span>
              </div>
            ) : catalogItems.length === 0 ? (
              <div className="py-6 text-center text-xs text-on-surface-variant bg-surface-container-lowest rounded-xl border border-outline-variant/30">
                No matching catalog items found. Try another search term.
              </div>
            ) : (
              <div className="space-y-2.5 max-h-[360px] overflow-y-auto pr-1">
                {catalogItems.map((item) => (
                  <div
                    key={item.id}
                    className="p-3 rounded-xl bg-surface-container-lowest border border-outline-variant/40 hover:border-primary/40 transition-colors flex items-start justify-between gap-3"
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="text-xs font-medium text-on-surface leading-tight line-clamp-1">
                        {item.display_name}
                      </div>
                      <div className="text-[11px] text-on-surface-variant line-clamp-1">
                        {item.name_fi !== item.display_name ? `${item.name_fi} · ` : ''}
                        <span className="capitalize">{item.category}</span> · {item.pack_format}
                      </div>
                      {item.brand && (
                        <span className="inline-block px-1.5 py-0.5 rounded text-[10px] bg-surface-container-high text-on-surface-variant">
                          {item.brand}
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        const newPrompt = `Order 20 units of ${item.display_name} (${item.pack_format}) by Monday. Check price and warehouse availability.`;
                        setPrompt(newPrompt);
                      }}
                      className="px-2.5 py-1.5 rounded-lg bg-surface-container-high hover:bg-primary hover:text-on-primary text-xs font-medium text-primary transition-colors whitespace-nowrap shrink-0 flex items-center gap-1 cursor-pointer"
                      title="Ground AI order prompt with this product"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Use</span>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Valio Aimo Stock Summary */}
          <div className="p-6 rounded-2xl bg-surface-container border border-outline-variant/50 space-y-4">
            <div className="flex items-center gap-2.5">
              <PackageCheck className="w-5 h-5 text-primary shrink-0" />
              <h2 className="text-base font-semibold text-on-surface font-headline">
                Valio Aimo Warehouse Stock
              </h2>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="text-on-surface-variant border-b border-outline-variant/40">
                    <th className="pb-2.5 pr-3 font-medium">Item</th>
                    <th className="pb-2.5 px-3 text-right font-medium whitespace-nowrap">In Stock</th>
                    <th className="pb-2.5 pl-3 text-right font-medium whitespace-nowrap">Held</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant/30 tabular-nums">
                  {stock.slice(0, 5).map((item) => (
                    <tr key={item.sku}>
                      <td className="py-2.5 pr-3">
                        <div className="text-on-surface font-medium">{item.name}</div>
                        <div className="text-[11px] text-on-surface-variant capitalize">
                          {item.category} · {item.pack_format}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-right text-on-surface font-medium whitespace-nowrap">
                        {item.available_packs} boxes
                      </td>
                      <td
                        className={`py-2.5 pl-3 text-right font-medium whitespace-nowrap ${
                          item.reserved_packs > 0 ? 'text-error' : 'text-on-surface-variant'
                        }`}
                      >
                        {item.reserved_packs}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
