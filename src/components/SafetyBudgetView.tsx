import React, { useEffect, useState } from 'react';
import {
  PauseCircle,
  PlayCircle,
  Save,
  CheckCircle2,
  ShieldCheck,
  Clock,
  Ban,
  ArrowRight,
} from 'lucide-react';
import type {
  CustomerRosterItem,
  NavSectionId,
  NetworkOverview,
  OrderDTO,
  TenantPolicy,
} from '../types/aimogate';

interface SafetyBudgetViewProps {
  customer: CustomerRosterItem;
  policy: TenantPolicy;
  overview: NetworkOverview | null;
  orders: OrderDTO[];
  onUpdatePolicy: (patch: Partial<TenantPolicy>) => void;
  onOpenKillswitchModal: () => void;
  onNavigate: (nav: NavSectionId) => void;
}

const PROTECTION_LEVELS = [
  { label: 'Standard', value: 40 },
  { label: 'Balanced', value: 70 },
  { label: 'Strict', value: 85 },
];

export const SafetyBudgetView: React.FC<SafetyBudgetViewProps> = ({
  customer,
  policy,
  overview,
  orders,
  onUpdatePolicy,
  onOpenKillswitchModal,
  onNavigate,
}) => {
  const [eurCap, setEurCap] = useState(policy.max_auto_approve_eur);
  const [litresCap, setLitresCap] = useState(policy.max_auto_approve_litres);
  const [sensitivity, setSensitivity] = useState(policy.anomaly_sensitivity_pct);
  const [autoDispute, setAutoDispute] = useState(policy.auto_dispute_enabled);

  useEffect(() => {
    setEurCap(policy.max_auto_approve_eur);
    setLitresCap(policy.max_auto_approve_litres);
    setSensitivity(policy.anomaly_sensitivity_pct);
    setAutoDispute(policy.auto_dispute_enabled);
  }, [policy]);

  const isHalted = overview?.killswitch_halted ?? false;

  const activeProtectionValue =
    sensitivity >= 80 ? 85 : sensitivity >= 55 ? 70 : 40;

  return (
    <div className="w-full max-w-[1360px] mx-auto px-4 sm:px-8 py-8 flex flex-col gap-8">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div className="space-y-1.5 max-w-2xl">
          <div className="text-xs text-on-surface-variant">{customer.tenant_name}</div>
          <h1 className="text-2xl lg:text-3xl font-semibold tracking-tight text-on-surface font-headline">
            Spending Limits
          </h1>
          <p className="text-sm text-on-surface-variant">
            Decide how large an order can be before you have to approve it, or pause automatic ordering completely.
          </p>
        </div>
      </div>

      {/* Pause Automatic Ordering Bar */}
      <div className="p-5 rounded-2xl bg-surface-container border border-outline-variant/50 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="text-sm font-semibold text-on-surface">
            {isHalted
              ? 'Automatic ordering is currently paused'
              : 'Automatic ordering is active'}
          </div>
          <p className="text-xs text-on-surface-variant">
            {isHalted
              ? 'All new orders across your restaurant locations are waiting for your manual approval.'
              : `Allowed items up to €${eurCap.toLocaleString()} and ${litresCap.toLocaleString()} L confirm automatically.`}
          </p>
        </div>

        <button
          type="button"
          onClick={onOpenKillswitchModal}
          className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
            isHalted
              ? 'bg-primary text-on-primary hover:bg-primary-fixed'
              : 'bg-error-container text-error hover:opacity-90'
          }`}
        >
          {isHalted ? (
            <PlayCircle className="w-4 h-4 shrink-0" />
          ) : (
            <PauseCircle className="w-4 h-4 shrink-0" />
          )}
          <span>{isHalted ? 'Resume Automatic Orders' : 'Pause All Automatic Orders'}</span>
        </button>
      </div>

      {/* Main Two-Column Section */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left: Limit Sliders */}
        <div className="lg:col-span-7 p-6 rounded-2xl bg-surface-container border border-outline-variant/50 space-y-6">
          <h2 className="text-base font-semibold text-on-surface font-headline">
            Automatic Approval Limits
          </h2>

          {/* EUR Cap Slider */}
          <div className="space-y-2.5">
            <div className="flex justify-between items-baseline gap-2 tabular-nums">
              <label htmlFor="eur-cap-slider" className="text-sm font-medium text-on-surface">
                Max order total without asking you
              </label>
              <span className="text-lg font-semibold text-primary">
                €{eurCap.toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </span>
            </div>
            <input
              id="eur-cap-slider"
              type="range"
              min={200}
              max={5000}
              step={50}
              value={eurCap}
              onChange={(e) => setEurCap(Number(e.target.value))}
              onMouseUp={() => onUpdatePolicy({ max_auto_approve_eur: eurCap })}
              onTouchEnd={() => onUpdatePolicy({ max_auto_approve_eur: eurCap })}
              className="w-full h-2 bg-surface-container-highest rounded-lg appearance-none cursor-pointer accent-primary"
            />
            <div className="flex justify-between text-xs text-on-surface-variant tabular-nums">
              <span>€200</span>
              <span>Set to €1,500+ to auto-approve 1,000L milk (€1,180)</span>
              <span>€5,000</span>
            </div>
          </div>

          {/* Volume Cap Slider */}
          <div className="space-y-2.5 pt-2 border-t border-outline-variant/40">
            <div className="flex justify-between items-baseline gap-2 tabular-nums">
              <label htmlFor="litres-cap-slider" className="text-sm font-medium text-on-surface">
                Max liquid volume per order
              </label>
              <span className="text-lg font-semibold text-primary">
                {litresCap.toLocaleString()} L
              </span>
            </div>
            <input
              id="litres-cap-slider"
              type="range"
              min={200}
              max={3000}
              step={100}
              value={litresCap}
              onChange={(e) => setLitresCap(Number(e.target.value))}
              onMouseUp={() => onUpdatePolicy({ max_auto_approve_litres: litresCap })}
              onTouchEnd={() => onUpdatePolicy({ max_auto_approve_litres: litresCap })}
              className="w-full h-2 bg-surface-container-highest rounded-lg appearance-none cursor-pointer accent-primary"
            />
            <div className="flex justify-between text-xs text-on-surface-variant tabular-nums">
              <span>200 L</span>
              <span>Orders larger than {litresCap.toLocaleString()} L wait for your approval</span>
              <span>3,000 L</span>
            </div>
          </div>

          {/* Duplicate Order Protection */}
          <div className="space-y-2.5 pt-2 border-t border-outline-variant/40">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <div className="text-sm font-medium text-on-surface">
                  Duplicate &amp; unusual order protection
                </div>
                <p className="text-xs text-on-surface-variant">
                  Flags repeated orders for the same item placed close together.
                </p>
              </div>
              <div className="flex items-center gap-1 p-1 rounded-xl bg-surface-container-lowest border border-outline-variant/40 shrink-0">
                {PROTECTION_LEVELS.map((lvl) => (
                  <button
                    key={lvl.label}
                    type="button"
                    onClick={() => setSensitivity(lvl.value)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                      activeProtectionValue === lvl.value
                        ? 'bg-surface-container-high text-on-surface'
                        : 'text-on-surface-variant hover:text-on-surface'
                    }`}
                  >
                    {lvl.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Release Expired Holds Toggle */}
          <div className="flex items-center justify-between gap-4 pt-2 border-t border-outline-variant/40">
            <div className="space-y-0.5">
              <div className="text-sm font-medium text-on-surface">
                Release unclaimed stock holds after 15 minutes
              </div>
              <p className="text-xs text-on-surface-variant">
                Returns reserved boxes to Valio Aimo automatically if an order isn&apos;t confirmed in time.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={autoDispute}
              aria-label="Release unclaimed stock holds automatically"
              onClick={() => setAutoDispute((v) => !v)}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                autoDispute ? 'bg-primary' : 'bg-surface-container-highest'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-on-primary-fixed shadow-sm transition-transform ${
                  autoDispute ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          <div className="pt-2">
            <button
              type="button"
              onClick={() =>
                onUpdatePolicy({
                  max_auto_approve_eur: eurCap,
                  max_auto_approve_litres: litresCap,
                  anomaly_sensitivity_pct: sensitivity,
                  auto_dispute_enabled: autoDispute,
                })
              }
              className="w-full py-2.5 px-4 bg-primary text-on-primary hover:bg-primary-fixed font-semibold text-sm rounded-xl transition-colors inline-flex items-center justify-center gap-2 cursor-pointer"
            >
              <Save className="w-4 h-4" />
              <span>Save Spending Limits</span>
            </button>
          </div>
        </div>

        {/* Right: How Approvals Work */}
        <div className="lg:col-span-5 p-6 rounded-2xl bg-surface-container border border-outline-variant/50 space-y-5">
          <h2 className="text-base font-semibold text-on-surface font-headline">
            How Order Approvals Work
          </h2>

          <div className="space-y-4 text-sm">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="w-4 h-4 text-primary shrink-0 mt-1" />
              <div>
                <div className="font-medium text-on-surface tabular-nums">
                  1. Under €{eurCap.toLocaleString()} &amp; {litresCap.toLocaleString()} L
                </div>
                <p className="text-xs text-on-surface-variant mt-0.5">
                  Orders for allowed categories confirm automatically without interrupting service.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <Clock className="w-4 h-4 text-error shrink-0 mt-1" />
              <div>
                <div className="font-medium text-on-surface">
                  2. Over limit or restricted category
                </div>
                <p className="text-xs text-on-surface-variant mt-0.5">
                  Stock and price are held for 15 minutes while waiting for your approval.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <ShieldCheck className="w-4 h-4 text-primary shrink-0 mt-1" />
              <div>
                <div className="font-medium text-on-surface">
                  3. Only managers can approve
                </div>
                <p className="text-xs text-on-surface-variant mt-0.5">
                  Automated ordering tools can submit requests, but can never approve large orders or raise spending limits on their own.
                </p>
              </div>
            </div>
          </div>

          <div className="pt-4 border-t border-outline-variant/40 space-y-1 text-xs">
            <div className="text-on-surface-variant">Signed in as</div>
            <div className="text-sm font-medium text-on-surface">
              Elena Vance · Kitchen &amp; Purchasing Manager
            </div>
          </div>
        </div>
      </div>

      {/* Recent Limit Checks Table */}
      <div className="rounded-2xl bg-surface-container border border-outline-variant/50 overflow-hidden">
        <div className="px-6 py-4 border-b border-outline-variant/40 flex items-center justify-between gap-4">
          <h2 className="text-base font-semibold text-on-surface font-headline">
            Recent Limit Checks
          </h2>
          <button
            type="button"
            onClick={() => onNavigate('audit-and-agent-logs')}
            className="text-xs text-primary hover:underline inline-flex items-center gap-1 cursor-pointer"
          >
            <span>View all order history</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-xs text-on-surface-variant border-b border-outline-variant/40">
                <th className="py-3 px-6 font-medium">Time</th>
                <th className="py-3 px-4 font-medium">Item</th>
                <th className="py-3 px-4 font-medium text-right">Total</th>
                <th className="py-3 px-6 font-medium text-right">Outcome</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/30 tabular-nums">
              {orders.slice(0, 6).map((ord) => (
                <tr key={ord.order_id} className="hover:bg-surface-container-high/40 transition-colors">
                  <td className="py-3.5 px-6 text-xs text-on-surface-variant whitespace-nowrap">
                    {new Date(ord.created_at).toLocaleTimeString()}
                  </td>
                  <td className="py-3.5 px-4 text-on-surface">
                    {ord.product_name || ord.sku}
                  </td>
                  <td className="py-3.5 px-4 text-right font-medium text-on-surface whitespace-nowrap">
                    €{ord.total_eur.toFixed(2)}
                  </td>
                  <td className="py-3.5 px-6 text-right whitespace-nowrap text-xs font-medium">
                    {ord.status === 'CONFIRMED' ? (
                      <span className="inline-flex items-center gap-1.5 text-primary">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>
                          {ord.approval_type === 'AUTO' ? 'Auto-approved' : 'Approved'}
                        </span>
                      </span>
                    ) : ord.status === 'PENDING_APPROVAL' ? (
                      <span className="inline-flex items-center gap-1.5 text-error">
                        <Clock className="w-3.5 h-3.5" />
                        <span>Waiting for approval</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-on-surface-variant">
                        <Ban className="w-3.5 h-3.5" />
                        <span>Declined</span>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {orders.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-8 text-center text-sm text-on-surface-variant">
                    No order limit checks yet for this location.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
