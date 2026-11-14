import React from 'react';
import { ShieldAlert, ShieldCheck, X, Lock, EyeOff, CheckCircle2 } from 'lucide-react';
import type { ZeroTrustInspectResponse } from '../types/aimogate';

interface KillswitchModalProps {
  open: boolean;
  isHalted: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export const KillswitchModal: React.FC<KillswitchModalProps> = ({
  open,
  isHalted,
  onClose,
  onConfirm,
}) => {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="killswitch-modal-title"
    >
      <div className="w-full max-w-md rounded-2xl bg-surface-container border border-outline-variant/60 shadow-2xl p-6 space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-error-container flex items-center justify-center text-error shrink-0">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div>
              <h2 id="killswitch-modal-title" className="text-base font-semibold text-on-surface">
                {isHalted ? 'Resume Automatic Ordering' : 'Pause All Automatic Orders'}
              </h2>
              <p className="text-xs text-on-surface-variant">
                {isHalted ? 'Re-enable kitchen auto-orders' : 'Safety hold across all locations'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close pause dialog"
            className="p-2 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-sm text-on-surface-variant leading-relaxed">
          {isHalted
            ? 'Resuming will let orders within your spending limits confirm automatically again.'
            : 'Pausing holds every new order across all restaurant locations so nothing is confirmed without your direct approval.'}
        </p>

        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-surface-container-high text-sm font-medium text-on-surface hover:bg-surface-container-highest transition-colors cursor-pointer whitespace-nowrap"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              onConfirm();
              onClose();
            }}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors cursor-pointer whitespace-nowrap ${
              isHalted
                ? 'bg-primary text-on-primary hover:bg-primary-fixed'
                : 'bg-error text-on-error hover:opacity-90'
            }`}
          >
            {isHalted ? 'Resume Ordering' : 'Pause All Orders'}
          </button>
        </div>
      </div>
    </div>
  );
};

interface ZeroTrustModalProps {
  open: boolean;
  data: ZeroTrustInspectResponse | null;
  onClose: () => void;
}

export const ZeroTrustModal: React.FC<ZeroTrustModalProps> = ({ open, data, onClose }) => {
  if (!open || !data) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="zt-modal-title"
    >
      <div className="w-full max-w-5xl max-h-[88vh] rounded-2xl bg-surface-container border border-outline-variant/60 shadow-2xl flex flex-col overflow-hidden">
        <div className="px-6 py-4 bg-surface-container-high/70 border-b border-outline-variant/50 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-surface-container border border-outline-variant/60 flex items-center justify-center text-primary shrink-0">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h2 id="zt-modal-title" className="text-base font-semibold text-on-surface">
                Supplier Privacy Check
              </h2>
              <p className="text-xs text-on-surface-variant">
                Verify that Valio Aimo keeps internal costs, profit margins, and unreleased items hidden from external ordering tools.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close supplier privacy dialog"
            className="p-2 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left: Private Valio Aimo Internal View */}
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-semibold text-on-surface">
                <Lock className="w-4 h-4 text-error shrink-0" />
                <span>Private Supplier Records</span>
              </div>
              <span className="text-xs text-error font-medium">Never shared</span>
            </div>
            <div className="space-y-2.5">
              {data.raw_erp_database_view.records.map((rec) => (
                <div
                  key={rec.sku}
                  className="p-3.5 rounded-xl bg-surface-container-lowest border border-outline-variant/50 text-xs space-y-1.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-on-surface">{rec.name}</span>
                    <span
                      className={`text-xs font-medium ${
                        rec.roadmap_status === 'UNRELEASED'
                          ? 'text-error'
                          : 'text-on-surface-variant'
                      }`}
                    >
                      {rec.roadmap_status === 'UNRELEASED' ? 'Not yet released' : 'Live catalog'}
                    </span>
                  </div>
                  <div className="text-xs text-on-surface-variant font-mono">{rec.sku}</div>
                  <div className="flex flex-wrap gap-4 pt-1 text-xs text-error tabular-nums">
                    <span>Wholesale cost: €{rec.internal_cost_eur.toFixed(2)}</span>
                    <span>Margin: {rec.internal_margin_pct}%</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Right: Shared Customer Catalog */}
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-semibold text-on-surface">
                <EyeOff className="w-4 h-4 text-primary shrink-0" />
                <span>Shared Ordering Catalog</span>
              </div>
              <span className="text-xs text-primary font-medium">Safe to share</span>
            </div>
            <div className="p-3.5 rounded-xl bg-surface-container-lowest border border-outline-variant/50 text-xs text-on-surface-variant space-y-1.5">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-primary shrink-0" />
                <span>
                  Hidden fields:{' '}
                  <span className="text-on-surface">
                    supplier cost, profit margins, and total warehouse counts
                  </span>
                </span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-primary shrink-0" />
                <span>
                  Hidden unreleased items:{' '}
                  <span className="text-on-surface">
                    {data.sanitized_agent_gateway_view.unreleased_skus_omitted.join(', ')}
                  </span>
                </span>
              </div>
            </div>

            <div className="space-y-2.5">
              {data.sanitized_agent_gateway_view.records.map((rec) => (
                <div
                  key={rec.sku}
                  className="p-3.5 rounded-xl bg-surface-container-lowest border border-outline-variant/50 text-xs space-y-1.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-on-surface">{rec.name}</span>
                    <span className="text-xs text-on-surface-variant">{rec.pack_format}</span>
                  </div>
                  <div className="text-xs text-on-surface-variant font-mono">{rec.sku}</div>
                  <div className="flex flex-wrap gap-4 pt-1 text-xs text-on-surface-variant tabular-nums">
                    <span>Pack price: €{rec.unit_contract_price_eur.toFixed(2)}</span>
                    <span>Per litre: €{rec.price_per_litre_eur.toFixed(2)}/L</span>
                    <span className="text-primary font-medium">
                      1,000L total: €{rec.total_contract_price_eur?.toFixed(2)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
