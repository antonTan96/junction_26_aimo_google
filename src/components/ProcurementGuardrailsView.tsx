import React, { useMemo, useState } from 'react';
import {
  History,
  Tag,
  Filter,
  Plus,
  Milk,
  Leaf,
  Croissant,
  Coffee,
  Sparkles,
  Beef,
  Wine,
  ArrowRight,
  ChevronDown,
  ChevronRight,
  Eye,
} from 'lucide-react';
import type {
  AuditLogEntry,
  CustomerRosterItem,
  GuardrailWhitelistDTO,
  NavSectionId,
  OrderDTO,
  TenantPolicy,
} from '../types/aimogate';

interface ProcurementGuardrailsViewProps {
  customer: CustomerRosterItem;
  policy: TenantPolicy;
  guardrails: GuardrailWhitelistDTO | null;
  orders: OrderDTO[];
  auditLogs: AuditLogEntry[];
  globalSearch: string;
  onToggleCategory: (category: string) => void;
  onPublishPolicies: () => void;
  onOpenZeroTrustModal: () => void;
  onNavigate: (nav: NavSectionId) => void;
}

const CATEGORY_METADATA: Record<
  string,
  {
    title: string;
    subtitle: string;
    examples: string;
    icon: React.ComponentType<{ className?: string }>;
  }
> = {
  dairy: {
    title: 'Dairy & Milk',
    subtitle: 'Lactose-free milk, cream, and everyday cold dairy',
    examples: 'Valio Eila 10L Bag-in-Box, 12×1L Milk Cartons',
    icon: Milk,
  },
  'plant-based': {
    title: 'Plant-Based & Oat Drinks',
    subtitle: 'Barista oat milk and vegan breakfast alternatives',
    examples: 'Valio Oddlygood Barista Oat 10L',
    icon: Leaf,
  },
  bakery: {
    title: 'Bakery & Pastries',
    subtitle: 'Frozen butter croissants, breakfast rolls, and pastries',
    examples: 'Valio Bakery Butter Croissants (50 pcs)',
    icon: Croissant,
  },
  beverages: {
    title: 'Coffee, Tea & Juices',
    subtitle: 'Breakfast juices, coffee beans, and bar mixers',
    examples: 'Valio Aimo Beverages, Paulig Coffee',
    icon: Coffee,
  },
  cleaning: {
    title: 'Kitchen Cleaning & Hygiene',
    subtitle: 'Dishwasher detergents and food-safe kitchen sanitizers',
    examples: 'Valio Pro Hygiene 5L',
    icon: Sparkles,
  },
  meat: {
    title: 'Meat & Poultry',
    subtitle: 'Fresh chilled meats, poultry, and charcuterie cuts',
    examples: 'Atria Foodservice, HKScan',
    icon: Beef,
  },
  alcohol: {
    title: 'Wine & Spirits',
    subtitle: 'Licensed bar stock — always requires manager sign-off',
    examples: 'Alko Wholesale, Hartwall',
    icon: Wine,
  },
};

export const ProcurementGuardrailsView: React.FC<ProcurementGuardrailsViewProps> = ({
  customer,
  policy,
  guardrails,
  orders,
  globalSearch,
  onToggleCategory,
  onOpenZeroTrustModal,
  onNavigate,
}) => {
  const [catFilter, setCatFilter] = useState('');
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);

  const allCategories = guardrails?.all_system_categories ?? [
    'dairy',
    'plant-based',
    'bakery',
    'beverages',
    'cleaning',
    'meat',
    'alcohol',
  ];
  const allowedCategories = guardrails?.allowed_categories ?? policy.allowed_categories;

  const combinedQuery = (catFilter || globalSearch).trim().toLowerCase();
  const visibleCategories = useMemo(() => {
    if (!combinedQuery) return allCategories;
    return allCategories.filter((cat) => {
      const meta = CATEGORY_METADATA[cat];
      return (
        cat.includes(combinedQuery) ||
        meta?.title.toLowerCase().includes(combinedQuery) ||
        meta?.examples.toLowerCase().includes(combinedQuery)
      );
    });
  }, [allCategories, combinedQuery]);

  const confirmedSpend = orders
    .filter((o) => o.status === 'CONFIRMED')
    .reduce((sum, o) => sum + o.total_eur, 0);
  const monthlyBudget = Math.max(policy.max_auto_approve_eur * 10, 5000);
  const burnPct = Math.min(100, Math.round((confirmedSpend / monthlyBudget) * 100));
  const pendingCount = orders.filter((o) => o.status === 'PENDING_APPROVAL').length;
  const recentOrders = useMemo(() => orders.slice(0, 3), [orders]);

  return (
    <div className="w-full max-w-[1360px] mx-auto px-4 sm:px-8 py-8 flex flex-col gap-8">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div className="space-y-1.5 max-w-2xl">
          <div className="text-xs text-on-surface-variant">{customer.tenant_name}</div>
          <h1 className="text-2xl lg:text-3xl font-semibold tracking-tight text-on-surface font-headline">
            Allowed Items
          </h1>
          <p className="text-sm text-on-surface-variant">
            Choose which kitchen supplies can be ordered automatically up to €
            {policy.max_auto_approve_eur.toLocaleString()}. Everything else waits for your approval.
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => onNavigate('audit-and-agent-logs')}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-surface-container border border-outline-variant/60 hover:bg-surface-container-high text-sm font-medium text-on-surface transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <History className="w-4 h-4 text-on-surface-variant" />
            <span>Order History</span>
          </button>
          <button
            type="button"
            onClick={() => onNavigate('autonomous-prompt-scheduler')}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary hover:bg-primary-fixed text-on-primary text-sm font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Place an Order</span>
          </button>
        </div>
      </div>

      {/* Clean 3-Stat Summary Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 rounded-2xl bg-surface-container border border-outline-variant/50 divide-y sm:divide-y-0 sm:divide-x divide-outline-variant/40 tabular-nums">
        <div className="p-5 flex flex-col gap-1">
          <span className="text-xs font-medium text-on-surface-variant">
            Allowed Automatically
          </span>
          <div className="text-2xl font-semibold text-on-surface font-headline">
            {allowedCategories.length} of {allCategories.length} categories
          </div>
          <span className="text-xs text-on-surface-variant">
            {allCategories.length - allowedCategories.length} require your approval
          </span>
        </div>

        <div className="p-5 flex flex-col gap-1">
          <span className="text-xs font-medium text-on-surface-variant">
            Approved Spend So Far
          </span>
          <div className="text-2xl font-semibold text-on-surface font-headline">
            €{confirmedSpend.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <span className="text-xs text-on-surface-variant">
            {burnPct}% of €{monthlyBudget.toLocaleString()} monthly budget
          </span>
        </div>

        <div className="p-5 flex flex-col gap-1">
          <span className="text-xs font-medium text-on-surface-variant">
            Orders Waiting for You
          </span>
          <div className="text-2xl font-semibold text-on-surface font-headline">
            {pendingCount}
          </div>
          <span className={`text-xs ${pendingCount > 0 ? 'text-error font-medium' : 'text-on-surface-variant'}`}>
            {pendingCount > 0
              ? 'Needs your review in Orders & Approvals'
              : `Auto-approving up to €${policy.max_auto_approve_eur.toLocaleString()}`}
          </span>
        </div>
      </div>

      {/* Main Content: Category List (Left 8) + Summary Column (Right 4) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left: Supply Categories */}
        <div className="lg:col-span-8 flex flex-col gap-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-on-surface font-headline">
              Kitchen Supply Categories
            </h2>
            <div className="relative flex items-center">
              <Filter className="w-4 h-4 absolute left-3 text-on-surface-variant pointer-events-none" />
              <input
                type="text"
                aria-label="Filter supply categories"
                value={catFilter}
                onChange={(e) => setCatFilter(e.target.value)}
                placeholder="Filter categories..."
                className="h-9 w-full sm:w-56 bg-surface-container-lowest text-on-surface text-sm rounded-xl pl-9 pr-3 border border-outline-variant/50 placeholder:text-on-surface-variant/60 focus:outline-none focus:border-primary/50"
              />
            </div>
          </div>

          <div className="rounded-2xl bg-surface-container border border-outline-variant/50 divide-y divide-outline-variant/40 overflow-hidden">
            {visibleCategories.map((cat) => {
              const isAllowed = allowedCategories.includes(cat);
              const meta = CATEGORY_METADATA[cat] || {
                title: cat,
                subtitle: 'Valio Aimo supply category',
                examples: 'Valio Aimo catalog items',
                icon: Tag,
              };
              const Icon = meta.icon;
              const isExpanded = expandedCategory === cat;

              return (
                <div key={cat} className="p-4 sm:p-5 flex flex-col gap-3">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3.5 min-w-0">
                      <div
                        className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border ${
                          isAllowed
                            ? 'bg-primary-container/30 border-primary/20 text-primary'
                            : 'bg-surface-container-high border-outline-variant/50 text-on-surface-variant'
                        }`}
                      >
                        <Icon className="w-5 h-5" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-on-surface">
                          {meta.title}
                        </div>
                        <p className="text-xs text-on-surface-variant truncate">
                          {meta.subtitle}
                        </p>
                        <p className="text-[11px] text-on-surface-variant/75 truncate mt-1">
                          {meta.examples}
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-col items-end gap-2 shrink-0">
                      <div className="flex items-center gap-4">
                        <div className="hidden sm:block text-right">
                          <div
                            className={`text-xs font-medium ${
                              isAllowed ? 'text-primary' : 'text-on-surface-variant'
                            }`}
                          >
                            {isAllowed
                              ? `Auto-approved up to €${policy.max_auto_approve_eur.toLocaleString()}`
                              : 'Needs your approval'}
                          </div>
                        </div>

                        <button
                          type="button"
                          role="switch"
                          aria-checked={isAllowed}
                          aria-label={`Allow automatic orders for ${meta.title}`}
                          onClick={() => onToggleCategory(cat)}
                          className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                            isAllowed ? 'bg-primary' : 'bg-surface-container-highest'
                          }`}
                        >
                          <span
                            className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-on-primary-fixed shadow-sm transition-transform ${
                              isAllowed ? 'translate-x-6' : 'translate-x-1'
                            }`}
                          />
                        </button>
                      </div>

                      <button
                        type="button"
                        onClick={() => setExpandedCategory(isExpanded ? null : cat)}
                        className="inline-flex items-center gap-1 text-xs text-on-surface-variant hover:text-primary transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        <span>{isExpanded ? 'Hide rule' : 'Rule details'}</span>
                        {isExpanded ? (
                          <ChevronDown className="w-3.5 h-3.5" />
                        ) : (
                          <ChevronRight className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="pl-14 pt-2 border-t border-outline-variant/30 flex flex-wrap items-center justify-between gap-2 text-xs text-on-surface-variant">
                      <span>
                        {isAllowed
                          ? `Orders in ${meta.title} under €${policy.max_auto_approve_eur} and ${policy.max_auto_approve_litres}L confirm automatically.`
                          : `Any order in ${meta.title} is held until a manager approves it.`}
                      </span>
                      <button
                        type="button"
                        onClick={() => onNavigate('safety-and-budget-limits')}
                        className="text-primary hover:underline whitespace-nowrap cursor-pointer"
                      >
                        Change €{policy.max_auto_approve_eur} limit →
                      </button>
                    </div>
                  )}
                </div>
              );
            })}

            {visibleCategories.length === 0 && (
              <div className="p-8 text-center text-sm text-on-surface-variant">
                No categories match &ldquo;{combinedQuery}&rdquo;.
              </div>
            )}
          </div>
        </div>

        {/* Right: Quick Rules & Recent Orders */}
        <div className="lg:col-span-4 flex flex-col gap-6">
          <div className="p-5 rounded-2xl bg-surface-container border border-outline-variant/50 flex flex-col gap-4">
            <h2 className="text-base font-semibold text-on-surface font-headline">
              Current Ordering Rules
            </h2>
            <div className="space-y-3 text-sm tabular-nums">
              <div className="flex items-center justify-between">
                <span className="text-on-surface-variant">Auto-approve limit</span>
                <span className="font-semibold text-on-surface">
                  €{policy.max_auto_approve_eur.toLocaleString()}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-on-surface-variant">Max volume per order</span>
                <span className="font-semibold text-on-surface">
                  {policy.max_auto_approve_litres.toLocaleString()} L
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-on-surface-variant">Price &amp; stock hold</span>
                <span className="font-semibold text-on-surface">15 minutes</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-on-surface-variant">Pre-approved windows</span>
                <span className="font-semibold text-on-surface">
                  {guardrails?.active_grants_count ?? 0} active
                </span>
              </div>
            </div>
            <div className="pt-2 border-t border-outline-variant/40 flex flex-col gap-2">
              <button
                type="button"
                onClick={() => onNavigate('safety-and-budget-limits')}
                className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline font-medium cursor-pointer"
              >
                <span>Adjust spending limits</span>
                <ArrowRight className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={onOpenZeroTrustModal}
                className="inline-flex items-center gap-1.5 text-xs text-on-surface-variant hover:text-on-surface cursor-pointer"
              >
                <Eye className="w-3.5 h-3.5" />
                <span>Check what Valio Aimo keeps private</span>
              </button>
            </div>
          </div>

          <div className="p-5 rounded-2xl bg-surface-container border border-outline-variant/50 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-on-surface font-headline">
                Recent Orders
              </h2>
              <button
                type="button"
                onClick={() => onNavigate('audit-and-agent-logs')}
                className="text-xs text-primary hover:underline cursor-pointer"
              >
                See all
              </button>
            </div>

            {recentOrders.length === 0 ? (
              <p className="text-xs text-on-surface-variant">
                No orders yet for this location. Place an order to test your settings.
              </p>
            ) : (
              <div className="divide-y divide-outline-variant/40">
                {recentOrders.map((ord) => {
                  const statusLabel =
                    ord.status === 'PENDING_APPROVAL'
                      ? 'Needs approval'
                      : ord.status === 'REJECTED'
                      ? 'Declined'
                      : 'Confirmed';
                  const statusColor =
                    ord.status === 'PENDING_APPROVAL'
                      ? 'text-error'
                      : ord.status === 'REJECTED'
                      ? 'text-on-surface-variant'
                      : 'text-primary';

                  return (
                    <div key={ord.order_id} className="py-3 first:pt-0 last:pb-0 space-y-1">
                      <div className="flex items-center justify-between gap-2 text-sm">
                        <span className="font-medium text-on-surface truncate">
                          {ord.product_name || ord.sku}
                        </span>
                        <span className="font-semibold text-on-surface tabular-nums shrink-0">
                          €{ord.total_eur.toFixed(2)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className={statusColor}>{statusLabel}</span>
                        <span className="text-on-surface-variant tabular-nums">
                          {ord.pack_quantity} boxes
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
