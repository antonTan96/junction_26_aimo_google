import React, { useEffect, useMemo, useState } from 'react';
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
  ChevronUp,
  ChevronRight,
  Eye,
  Clock,
  Calendar,
  CalendarCheck,
  AlertTriangle,
  ShieldCheck,
  Check,
  RotateCcw,
  Sliders,
  Gauge,
  Info,
} from 'lucide-react';
import type {
  AuditLogEntry,
  CategoryRule,
  CategoryRuleUsageDTO,
  CategoryTimeWindow,
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
  onUpdateCategoryRule?: (
    category: string,
    patch: Partial<Omit<CategoryRule, 'category'>>
  ) => Promise<void>;
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

function getWindowLabel(window: CategoryTimeWindow | undefined): string {
  switch (window) {
    case 'weekly':
      return 'Weekly';
    case 'daily':
      return 'Daily';
    case 'monthly':
      return 'Monthly';
    case 'none':
    default:
      return 'Per-order';
  }
}

function getWindowUnit(window: CategoryTimeWindow | undefined): string {
  switch (window) {
    case 'weekly':
      return '/week';
    case 'daily':
      return '/day';
    case 'monthly':
      return '/month';
    case 'none':
    default:
      return '';
  }
}

function formatRuleValidUntil(validUntil: string | null | undefined): string {
  if (!validUntil) return 'No expiration (Perpetual)';
  const date = new Date(validUntil);
  if (isNaN(date.getTime())) return validUntil;
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

interface CategoryRuleEditorProps {
  category: string;
  categoryTitle: string;
  ruleUsage: CategoryRuleUsageDTO | undefined;
  defaultMaxEur: number;
  defaultMaxLitres: number;
  onSave?: (
    category: string,
    patch: Partial<Omit<CategoryRule, 'category'>>
  ) => Promise<void>;
  onClose: () => void;
}

const CategoryRuleEditor: React.FC<CategoryRuleEditorProps> = ({
  category,
  categoryTitle,
  ruleUsage,
  defaultMaxEur,
  defaultMaxLitres,
  onSave,
  onClose,
}) => {
  const currentWindow: CategoryTimeWindow = ruleUsage?.time_window ?? 'weekly';
  const currentMaxEur = ruleUsage?.max_spend_eur ?? defaultMaxEur;
  const currentMaxLitres = ruleUsage?.max_storage_litres ?? defaultMaxLitres;
  const currentValidUntil = ruleUsage?.rule_valid_until ?? null;

  const [maxSpend, setMaxSpend] = useState<number>(currentMaxEur);
  const [maxStorage, setMaxStorage] = useState<number>(currentMaxLitres);
  const [timeWindow, setTimeWindow] = useState<CategoryTimeWindow>(currentWindow);
  const [validUntil, setValidUntil] = useState<string | null>(currentValidUntil);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    setMaxSpend(ruleUsage?.max_spend_eur ?? defaultMaxEur);
    setMaxStorage(ruleUsage?.max_storage_litres ?? defaultMaxLitres);
    setTimeWindow(ruleUsage?.time_window ?? 'weekly');
    setValidUntil(ruleUsage?.rule_valid_until ?? null);
  }, [ruleUsage, defaultMaxEur, defaultMaxLitres]);

  const handleExtendDays = (days: number) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    d.setHours(23, 59, 59, 999);
    setValidUntil(d.toISOString());
  };

  const handleSetPerpetual = () => {
    setValidUntil(null);
  };

  const handleCustomDateChange = (dateStr: string) => {
    if (!dateStr) {
      setValidUntil(null);
      return;
    }
    const d = new Date(`${dateStr}T23:59:59.999Z`);
    setValidUntil(d.toISOString());
  };

  const dateInputValue = validUntil ? validUntil.split('T')[0] : '';
  const isExpired = validUntil ? Date.now() > new Date(validUntil).getTime() : false;
  const daysRemaining = validUntil
    ? Math.max(0, Math.ceil((new Date(validUntil).getTime() - Date.now()) / 86400000))
    : null;

  const handleSave = async () => {
    if (!onSave) return;
    setIsSaving(true);
    setErrorMessage(null);
    setSaveSuccess(false);
    try {
      await onSave(category, {
        max_spend_eur: Number(maxSpend),
        max_storage_litres: Number(maxStorage),
        time_window: timeWindow,
        rule_valid_until: validUntil,
      });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3500);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to save category rule';
      setErrorMessage(msg);
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = () => {
    setMaxSpend(currentMaxEur);
    setMaxStorage(currentMaxLitres);
    setTimeWindow(currentWindow);
    setValidUntil(currentValidUntil);
    setErrorMessage(null);
  };

  const consumedEur = ruleUsage?.current_period_consumed_eur ?? 0;
  const usagePct = maxSpend > 0 ? Math.min(100, Math.round((consumedEur / maxSpend) * 100)) : 0;
  const windowLabel = getWindowLabel(timeWindow);
  const windowUnit = getWindowUnit(timeWindow);

  const spendPresets = [250, 500, 800, 1200, 2500];
  const storagePresets = [250, 500, 1000, 2500, 5000];
  const windowOptions: Array<{ value: CategoryTimeWindow; label: string; sub: string }> = [
    { value: 'weekly', label: 'Weekly', sub: 'Rolling 7 days' },
    { value: 'daily', label: 'Daily', sub: 'Rolling 24 hours' },
    { value: 'monthly', label: 'Monthly', sub: 'Rolling 30 days' },
    { value: 'none', label: 'Per-order', sub: 'No time window' },
  ];

  return (
    <div className="mt-4 pt-4 border-t border-outline-variant/30 flex flex-col gap-5 text-on-surface">
      {/* Rule Status Header Banner */}
      {isExpired ? (
        <div className="p-3.5 rounded-xl bg-error-container/40 border border-error/40 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-error shrink-0 mt-0.5" />
          <div className="space-y-0.5 min-w-0">
            <div className="text-sm font-semibold text-error">
              Rule expired - requires human approval
            </div>
            <p className="text-xs text-on-surface-variant">
              The auto-approve window for {categoryTitle} expired on{' '}
              <span className="font-medium text-on-surface">{formatRuleValidUntil(validUntil)}</span>.
              New orders currently require human review until you renew or extend this rule.
            </p>
          </div>
        </div>
      ) : validUntil ? (
        <div className="p-3.5 rounded-xl bg-primary-container/30 border border-primary/30 flex items-start gap-3">
          <CalendarCheck className="w-5 h-5 text-primary shrink-0 mt-0.5" />
          <div className="space-y-0.5 min-w-0">
            <div className="text-sm font-semibold text-primary">
              Rule active until {formatRuleValidUntil(validUntil)} ({daysRemaining}{' '}
              {daysRemaining === 1 ? 'day' : 'days'} remaining)
            </div>
            <p className="text-xs text-on-surface-variant">
              During this active window, orders auto-approve without repeated manual approvals as long as
              cumulative spending stays within your configured {windowLabel.toLowerCase()} budget.
            </p>
          </div>
        </div>
      ) : (
        <div className="p-3.5 rounded-xl bg-surface-container-high border border-outline-variant/40 flex items-start gap-3">
          <ShieldCheck className="w-5 h-5 text-primary shrink-0 mt-0.5" />
          <div className="space-y-0.5 min-w-0">
            <div className="text-sm font-semibold text-on-surface">
              Standing rule: Perpetual (No expiration date)
            </div>
            <p className="text-xs text-on-surface-variant">
              Orders auto-approve without expiring, evaluated continuously against your category monetary limit.
            </p>
          </div>
        </div>
      )}

      {/* Usage Meter & Spend Overview */}
      <div className="p-4 rounded-xl bg-surface-container-lowest/70 border border-outline-variant/40 flex flex-col gap-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Gauge className="w-4 h-4 text-primary" />
            <span className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
              {windowLabel} Monetary Budget Meter
            </span>
          </div>
          <div className="text-xs font-medium text-on-surface tabular-nums">
            <span className="text-primary font-semibold">€{consumedEur.toFixed(2)}</span> used of{' '}
            <span className="font-semibold">€{maxSpend.toLocaleString()}</span> limit
            {windowUnit && <span className="text-on-surface-variant">{windowUnit}</span>}
          </div>
        </div>

        {/* Meter Bar */}
        <div className="w-full bg-surface-container-highest h-2.5 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-300 ${
              consumedEur >= maxSpend && maxSpend > 0
                ? 'bg-error'
                : usagePct >= 80
                ? 'bg-amber-400'
                : 'bg-primary'
            }`}
            style={{ width: `${Math.min(100, Math.max(consumedEur > 0 ? 4 : 0, usagePct))}%` }}
          />
        </div>

        <div className="flex items-center justify-between text-[11px] text-on-surface-variant tabular-nums">
          <span>€0</span>
          <span>{usagePct}% consumed in active cycle</span>
          <span>
            €{Math.max(0, maxSpend - consumedEur).toFixed(2)} available budget
          </span>
        </div>
      </div>

      {/* Edit Form Section */}
      <div className="p-4 rounded-xl bg-surface-container-high/60 border border-outline-variant/40 flex flex-col gap-4">
        <div className="flex items-center justify-between border-b border-outline-variant/30 pb-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-on-surface">
            <Sliders className="w-4 h-4 text-primary" />
            <span>Configure Category Guardrails</span>
          </div>
          <span className="text-xs text-on-surface-variant">
            Updates take effect immediately on next order
          </span>
        </div>

        {/* 1. Category Monetary Spending Limit Input & Presets */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between text-xs">
            <label htmlFor={`max-spend-${category}`} className="font-medium text-on-surface">
              Category Monetary Spending Limit (€ / EUR)
            </label>
            <span className="text-on-surface-variant text-[11px]">
              Orders exceeding this in the time window trigger human review
            </span>
          </div>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
            <div className="relative flex-1">
              <span className="absolute left-3 top-2 text-xs font-semibold text-on-surface-variant pointer-events-none">
                €
              </span>
              <input
                id={`max-spend-${category}`}
                type="number"
                min="0"
                max="500000"
                step="50"
                value={maxSpend || ''}
                onChange={(e) => setMaxSpend(Math.max(0, Number(e.target.value)))}
                className="w-full h-9 rounded-lg bg-surface-container-lowest border border-outline-variant/60 pl-7 pr-3 text-sm font-medium text-on-surface placeholder:text-on-surface-variant/50 focus:outline-none focus:border-primary/60 tabular-nums"
                placeholder="e.g. 800"
              />
            </div>
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
              {spendPresets.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setMaxSpend(preset)}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                    maxSpend === preset
                      ? 'bg-primary text-on-primary font-semibold'
                      : 'bg-surface-container border border-outline-variant/50 text-on-surface-variant hover:text-on-surface'
                  }`}
                >
                  €{preset.toLocaleString()}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* 2. Time Period Window (Weekly / Daily / Monthly / None) */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between text-xs">
            <label className="font-medium text-on-surface">
              Time Period Aggregation Window
            </label>
            <span className="text-on-surface-variant text-[11px]">
              Reset interval for volume quota calculation
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {windowOptions.map((opt) => {
              const isSelected = timeWindow === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setTimeWindow(opt.value)}
                  className={`p-2.5 rounded-xl border text-left flex flex-col gap-0.5 transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-primary/10 border-primary text-on-surface ring-1 ring-primary/40'
                      : 'bg-surface-container border-outline-variant/50 text-on-surface-variant hover:text-on-surface hover:border-outline-variant'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className={`text-xs font-semibold ${isSelected ? 'text-primary' : ''}`}>
                      {opt.label}
                    </span>
                    {isSelected && <Check className="w-3.5 h-3.5 text-primary" />}
                  </div>
                  <span className="text-[11px] text-on-surface-variant/75">{opt.sub}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* 3. Rule Time Limit (Set / Extend) */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between text-xs">
            <label className="font-medium text-on-surface flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-primary" />
              <span>Set or Extend Rule Time Limit</span>
            </label>
            <span className="text-on-surface-variant text-[11px]">
              Auto-approve orders without repetitive owner sign-offs
            </span>
          </div>

          <div className="flex flex-col gap-2.5">
            {/* Quick Extension Chips */}
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-on-surface-variant mr-1">Quick extend:</span>
              <button
                type="button"
                onClick={() => handleExtendDays(7)}
                className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-surface-container border border-outline-variant/50 text-on-surface-variant hover:text-on-surface hover:border-primary/50 transition-colors cursor-pointer"
              >
                +7 Days
              </button>
              <button
                type="button"
                onClick={() => handleExtendDays(14)}
                className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-surface-container border border-outline-variant/50 text-on-surface-variant hover:text-on-surface hover:border-primary/50 transition-colors cursor-pointer"
              >
                +14 Days
              </button>
              <button
                type="button"
                onClick={() => handleExtendDays(30)}
                className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-surface-container border border-outline-variant/50 text-on-surface-variant hover:text-on-surface hover:border-primary/50 transition-colors cursor-pointer"
              >
                +30 Days
              </button>
              <button
                type="button"
                onClick={() => handleExtendDays(90)}
                className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-surface-container border border-outline-variant/50 text-on-surface-variant hover:text-on-surface hover:border-primary/50 transition-colors cursor-pointer"
              >
                +90 Days
              </button>
              <button
                type="button"
                onClick={handleSetPerpetual}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                  validUntil === null
                    ? 'bg-primary text-on-primary font-semibold'
                    : 'bg-surface-container border border-outline-variant/50 text-on-surface-variant hover:text-on-surface hover:border-primary/50'
                }`}
              >
                No limit (Perpetual)
              </button>
            </div>

            {/* Custom Date Input */}
            <div className="flex flex-col sm:flex-row sm:items-center gap-2">
              <div className="flex items-center gap-2 flex-1">
                <Calendar className="w-4 h-4 text-on-surface-variant shrink-0" />
                <input
                  type="date"
                  aria-label="Custom rule expiration date"
                  value={dateInputValue}
                  onChange={(e) => handleCustomDateChange(e.target.value)}
                  className="h-9 rounded-lg bg-surface-container-lowest border border-outline-variant/60 px-3 text-sm text-on-surface focus:outline-none focus:border-primary/60 cursor-pointer w-full sm:w-auto"
                />
              </div>
              <div className="text-xs text-on-surface-variant">
                {validUntil ? (
                  isExpired ? (
                    <span className="text-error font-medium">Selected date is in the past (expired)</span>
                  ) : (
                    <span>
                      Active until <strong className="text-on-surface">{formatRuleValidUntil(validUntil)}</strong>{' '}
                      ({daysRemaining} {daysRemaining === 1 ? 'day' : 'days'} remaining)
                    </span>
                  )
                ) : (
                  <span className="text-primary font-medium">Standing perpetual rule (no expiration)</span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Error or Success feedback */}
        {errorMessage && (
          <div className="text-xs text-error font-medium bg-error-container/40 p-2.5 rounded-lg border border-error/30">
            {errorMessage}
          </div>
        )}

        {saveSuccess && (
          <div className="text-xs text-primary font-medium bg-primary-container/40 p-2.5 rounded-lg border border-primary/30 flex items-center gap-2">
            <Check className="w-4 h-4 text-primary" />
            <span>Category guardrail saved successfully!</span>
          </div>
        )}

        {/* Actions Row */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-3 border-t border-outline-variant/30">
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <button
              type="button"
              disabled={isSaving}
              onClick={handleSave}
              className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-primary hover:bg-primary-fixed text-on-primary text-xs font-semibold transition-colors disabled:opacity-50 cursor-pointer w-full sm:w-auto shadow-sm"
            >
              {isSaving ? (
                <>
                  <RotateCcw className="w-3.5 h-3.5 animate-spin" />
                  <span>Saving Rule...</span>
                </>
              ) : saveSuccess ? (
                <>
                  <Check className="w-3.5 h-3.5" />
                  <span>Saved!</span>
                </>
              ) : (
                <>
                  <Check className="w-3.5 h-3.5" />
                  <span>Save Rule Configuration</span>
                </>
              )}
            </button>
            <button
              type="button"
              onClick={handleReset}
              disabled={isSaving}
              className="px-3 py-2 rounded-lg bg-surface-container border border-outline-variant/60 hover:bg-surface-container-high text-xs font-medium text-on-surface-variant hover:text-on-surface transition-colors cursor-pointer"
            >
              Reset
            </button>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="text-xs text-on-surface-variant hover:text-primary transition-colors cursor-pointer"
          >
            Collapse rule details
          </button>
        </div>
      </div>
    </div>
  );
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
  onUpdateCategoryRule,
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
            {policy.max_auto_approve_eur.toLocaleString()}. Configure storage volume caps, time periods, and active rule windows so your team never gets stuck waiting for manual sign-offs.
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

              // Extract category usage & rule configuration
              const defaultCatSpend: Record<string, number> = {
                dairy: 800,
                'plant-based': 600,
                bakery: 500,
                beverages: 400,
                meat: 1200,
                cleaning: 300,
                alcohol: 0,
              };

              const ruleUsage: CategoryRuleUsageDTO | undefined =
                guardrails?.category_usage?.[cat] ||
                (policy.category_rules?.[cat]
                  ? {
                      ...policy.category_rules[cat],
                      max_spend_eur:
                        policy.category_rules[cat].max_spend_eur ??
                        defaultCatSpend[cat] ??
                        policy.max_auto_approve_eur,
                      max_storage_litres:
                        policy.category_rules[cat].max_storage_litres ??
                        (cat === 'dairy' ? 1000 : policy.max_auto_approve_litres),
                      current_period_consumed_eur: 0,
                      current_period_consumed_litres: 0,
                      is_expired: policy.category_rules[cat].rule_valid_until
                        ? Date.now() > new Date(policy.category_rules[cat].rule_valid_until!).getTime()
                        : false,
                      days_remaining: policy.category_rules[cat].rule_valid_until
                        ? Math.max(
                            0,
                            Math.ceil(
                              (new Date(policy.category_rules[cat].rule_valid_until!).getTime() - Date.now()) /
                                86400000
                            )
                          )
                        : null,
                    }
                  : undefined);

              const timeWindow: CategoryTimeWindow = ruleUsage?.time_window ?? 'weekly';
              const maxSpendEur: number =
                ruleUsage?.max_spend_eur ??
                defaultCatSpend[cat] ??
                policy.max_auto_approve_eur;
              const consumedEur: number = ruleUsage?.current_period_consumed_eur ?? 0;
              const maxStorageLitres: number =
                ruleUsage?.max_storage_litres ??
                (cat === 'dairy' ? 1000 : policy.max_auto_approve_litres);
              const consumedLitres: number = ruleUsage?.current_period_consumed_litres ?? 0;
              const ruleValidUntil: string | null = ruleUsage?.rule_valid_until ?? null;
              const isExpired: boolean =
                ruleUsage?.is_expired ??
                (ruleValidUntil ? Date.now() > new Date(ruleValidUntil).getTime() : false);
              const daysRemaining: number | null =
                ruleUsage?.days_remaining ??
                (ruleValidUntil
                  ? Math.max(0, Math.ceil((new Date(ruleValidUntil).getTime() - Date.now()) / 86400000))
                  : null);

              const windowLabel = getWindowLabel(timeWindow);
              const windowUnit = getWindowUnit(timeWindow);
              const capDisplay = `${windowLabel} budget: €${maxSpendEur.toLocaleString()}${windowUnit}`;

              const usagePct =
                maxSpendEur > 0
                  ? Math.min(100, Math.round((consumedEur / maxSpendEur) * 100))
                  : 0;

              return (
                <div key={cat} className="p-4 sm:p-5 flex flex-col gap-3.5 transition-colors">
                  {/* Category Card Header Row */}
                  <div className="flex items-start sm:items-center justify-between gap-4">
                    <div className="flex items-start sm:items-center gap-3.5 min-w-0">
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
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-on-surface">
                            {meta.title}
                          </span>
                        </div>
                        <p className="text-xs text-on-surface-variant truncate">
                          {meta.subtitle}
                        </p>
                        <p className="text-[11px] text-on-surface-variant/75 truncate mt-0.5">
                          {meta.examples}
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-col items-end gap-2 shrink-0">
                      <div className="flex items-center gap-3 sm:gap-4">
                        <div className="hidden sm:block text-right">
                          <div
                            className={`text-xs font-medium ${
                              isAllowed ? 'text-primary' : 'text-on-surface-variant'
                            }`}
                          >
                            {isAllowed
                              ? `Auto-approved up to €${maxSpendEur.toLocaleString()}`
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
                        <span>{isExpanded ? 'Hide rule editor' : 'Configure rule'}</span>
                        {isExpanded ? (
                          <ChevronUp className="w-3.5 h-3.5" />
                        ) : (
                          <ChevronDown className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Surface Category Time Configuration & Rule Active Limit Strip */}
                  <div className="pl-0 sm:pl-[54px] pt-1 flex flex-col gap-2.5">
                    {/* Top sub-row: Weekly Cap + Rule Active Badge with wrapping and spacing */}
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <div className="flex items-center gap-2 font-semibold text-on-surface">
                        <div className="w-5 h-5 rounded-md bg-primary/10 flex items-center justify-center text-primary shrink-0">
                          <Clock className="w-3.5 h-3.5" />
                        </div>
                        <span>{capDisplay}</span>
                      </div>

                      {/* Rule Active / Expired Time Limit Badge */}
                      <div className="flex items-center">
                        {isExpired ? (
                          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-error-container text-error border border-error/30">
                            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                            <span>Rule expired - requires human approval</span>
                          </div>
                        ) : ruleValidUntil ? (
                          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium bg-primary-container/40 text-primary border border-primary/30">
                            <CalendarCheck className="w-3.5 h-3.5 shrink-0" />
                            <span>
                              Rule active until {formatRuleValidUntil(ruleValidUntil)} ({daysRemaining}{' '}
                              {daysRemaining === 1 ? 'day' : 'days'} remaining)
                            </span>
                          </div>
                        ) : (
                          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium bg-surface-container-high text-on-surface-variant border border-outline-variant/30">
                            <ShieldCheck className="w-3.5 h-3.5 shrink-0 text-primary" />
                            <span>Perpetual rule (no expiration)</span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Progress bar / usage meter on its own dedicated sub-row */}
                    <div className="flex flex-wrap items-center gap-3 text-xs">
                      <div className="flex-1 min-w-[140px] max-w-sm bg-surface-container-highest h-2 rounded-full overflow-hidden shrink-0">
                        <div
                          className={`h-full rounded-full transition-all duration-300 ${
                            consumedEur >= maxSpendEur && maxSpendEur > 0
                              ? 'bg-error'
                              : usagePct >= 80
                              ? 'bg-amber-400'
                              : 'bg-primary'
                          }`}
                          style={{
                            width: `${Math.min(100, Math.max(consumedEur > 0 ? 4 : 0, usagePct))}%`,
                          }}
                        />
                      </div>
                      <span className="text-[11px] text-on-surface-variant tabular-nums whitespace-nowrap">
                        <strong className="text-on-surface font-semibold">€{consumedEur.toFixed(2)}</strong> / €{maxSpendEur.toLocaleString()} ({usagePct}% used)
                      </span>
                    </div>
                  </div>

                  {/* Expanded Category Rule View & Form */}
                  {isExpanded && (
                    <CategoryRuleEditor
                      category={cat}
                      categoryTitle={meta.title}
                      ruleUsage={ruleUsage}
                      defaultMaxEur={maxSpendEur}
                      defaultMaxLitres={cat === 'dairy' ? 1000 : policy.max_auto_approve_litres}
                      onSave={onUpdateCategoryRule}
                      onClose={() => setExpandedCategory(null)}
                    />
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
              <div className="flex items-center justify-between">
                <span className="text-on-surface-variant">Shortage substitution rules</span>
                <span className="font-semibold text-on-surface">
                  {policy.substitution_rules ? Object.keys(policy.substitution_rules).length : 0} configured
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
                No orders yet for your restaurant. Place an order to test your settings.
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
