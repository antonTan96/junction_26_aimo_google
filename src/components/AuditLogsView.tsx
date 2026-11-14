import React, { useMemo, useState } from 'react';
import {
  Eye,
  Filter,
  Download,
  CheckCheck,
  PauseCircle,
  XCircle,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import type {
  AuditLogEntry,
  CustomerRosterItem,
  NetworkOverview,
  OrderDTO,
  TenantPolicy,
} from '../types/aimogate';

interface AuditLogsViewProps {
  customers: CustomerRosterItem[];
  allOrders: OrderDTO[];
  globalAuditLogs: AuditLogEntry[];
  overview: NetworkOverview | null;
  policy: TenantPolicy;
  globalSearch: string;
  onApproveOrder: (orderId: string) => void;
  onRejectOrder: (orderId: string) => void;
  onOpenZeroTrustModal: () => void;
}

export const AuditLogsView: React.FC<AuditLogsViewProps> = ({
  customers,
  allOrders,
  globalAuditLogs,
  overview,
  globalSearch,
  onApproveOrder,
  onRejectOrder,
  onOpenZeroTrustModal,
}) => {
  const [timeWindow, setTimeWindow] = useState<'24h' | '7d' | '30d'>('24h');
  const [tenantFilter, setTenantFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [localSearch, setLocalSearch] = useState('');
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(
    allOrders[0]?.order_id ?? null
  );
  const [showSteps, setShowSteps] = useState(false);

  const query = (localSearch || globalSearch).trim().toLowerCase();

  const filteredOrders = useMemo(() => {
    return allOrders.filter((ord) => {
      if (tenantFilter !== 'ALL' && ord.tenant_id !== tenantFilter) return false;
      if (statusFilter !== 'ALL' && ord.status !== statusFilter) return false;
      if (query) {
        const hay = `${ord.order_id} ${ord.sku || ''} ${ord.product_name || ''} ${ord.tenant_name || ''} ${ord.po_reference}`.toLowerCase();
        if (!hay.includes(query)) return false;
      }
      return true;
    });
  }, [allOrders, tenantFilter, statusFilter, query]);

  const activeOrder =
    filteredOrders.find((o) => o.order_id === selectedOrderId) ||
    filteredOrders[0] ||
    allOrders[0] ||
    null;

  const handleExportSummary = () => {
    const bundle = {
      exported_at: new Date().toISOString(),
      orders: filteredOrders,
      activity: globalAuditLogs.slice(0, 50),
    };
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `aimogate-orders-${overview?.ledger_height || 'latest'}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadOrderReceipt = (ord: OrderDTO) => {
    const blob = new Blob([JSON.stringify(ord, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${ord.order_id}-receipt.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="w-full max-w-[1360px] mx-auto px-4 sm:px-8 py-8 flex flex-col gap-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div className="space-y-1.5 max-w-2xl">
          <h1 className="text-2xl lg:text-3xl font-semibold tracking-tight text-on-surface font-headline">
            Order History
          </h1>
          <p className="text-sm text-on-surface-variant">
            Review past and pending Valio Aimo orders, download receipts, and verify supplier privacy rules.
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0 flex-wrap">
          <button
            type="button"
            onClick={handleExportSummary}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-surface-container border border-outline-variant/60 hover:bg-surface-container-high text-sm font-medium text-on-surface transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Download className="w-4 h-4 text-on-surface-variant" />
            <span>Export Summary</span>
          </button>
          <button
            type="button"
            onClick={onOpenZeroTrustModal}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-on-primary hover:bg-primary-fixed text-sm font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Eye className="w-4 h-4" />
            <span>Supplier Privacy Check</span>
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="p-3 rounded-2xl bg-surface-container border border-outline-variant/50 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center p-1 bg-surface-container-lowest rounded-xl border border-outline-variant/40 text-xs font-medium">
            {(['24h', '7d', '30d'] as const).map((tw) => (
              <button
                key={tw}
                type="button"
                onClick={() => setTimeWindow(tw)}
                className={`px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
                  timeWindow === tw
                    ? 'bg-surface-container-high text-on-surface font-semibold'
                    : 'text-on-surface-variant hover:text-on-surface'
                }`}
              >
                {tw === '24h' ? 'Last 24h' : tw === '7d' ? '7 Days' : '30 Days'}
              </button>
            ))}
          </div>

          <select
            aria-label="Filter by location"
            value={tenantFilter}
            onChange={(e) => setTenantFilter(e.target.value)}
            className="bg-surface-container-lowest border border-outline-variant/50 text-on-surface text-xs rounded-xl px-3 py-2 focus:outline-none cursor-pointer"
          >
            <option value="ALL">All Locations</option>
            {customers.map((c) => (
              <option key={c.tenant_id} value={c.tenant_id}>
                {c.tenant_name}
              </option>
            ))}
          </select>

          <select
            aria-label="Filter by order status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-surface-container-lowest border border-outline-variant/50 text-on-surface text-xs rounded-xl px-3 py-2 focus:outline-none cursor-pointer"
          >
            <option value="ALL">All Statuses</option>
            <option value="CONFIRMED">Confirmed</option>
            <option value="PENDING_APPROVAL">Needs Approval</option>
            <option value="REJECTED">Declined</option>
          </select>
        </div>

        <div className="relative w-full md:w-72">
          <Filter className="w-4 h-4 absolute left-3 top-2.5 text-on-surface-variant pointer-events-none" />
          <input
            type="text"
            aria-label="Filter orders by item, order number, or location"
            value={localSearch}
            onChange={(e) => setLocalSearch(e.target.value)}
            placeholder="Search item, order #, or location..."
            className="w-full h-9 bg-surface-container-lowest border border-outline-variant/50 text-xs text-on-surface placeholder:text-on-surface-variant/60 rounded-xl pl-9 pr-3 focus:outline-none focus:border-primary/50"
          />
        </div>
      </div>

      {/* Main Split Layout */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-8 items-start">
        {/* Left: Orders Table */}
        <div className="xl:col-span-7 rounded-2xl bg-surface-container border border-outline-variant/50 overflow-hidden">
          <div className="px-5 py-3.5 border-b border-outline-variant/40 flex items-center justify-between text-xs text-on-surface-variant">
            <span className="font-semibold text-on-surface text-sm">Orders</span>
            <span className="tabular-nums">
              Showing {filteredOrders.length} of {allOrders.length}
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-xs text-on-surface-variant border-b border-outline-variant/40">
                  <th className="py-3 pl-5 pr-2 font-medium whitespace-nowrap">Time</th>
                  <th className="py-3 px-2 font-medium">Item</th>
                  <th className="py-3 px-2 font-medium text-right whitespace-nowrap">Total</th>
                  <th className="py-3 pl-2 pr-5 font-medium text-right whitespace-nowrap">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/30 tabular-nums">
                {filteredOrders.map((ord) => {
                  const isSelected = activeOrder?.order_id === ord.order_id;
                  return (
                    <tr
                      key={ord.order_id}
                      onClick={() => setSelectedOrderId(ord.order_id)}
                      className={`cursor-pointer transition-colors ${
                        isSelected
                          ? 'bg-surface-container-high/80'
                          : 'hover:bg-surface-container-high/40'
                      }`}
                    >
                      <td className="py-3.5 pl-5 pr-2 text-xs text-on-surface-variant whitespace-nowrap">
                        {new Date(ord.created_at).toLocaleTimeString()}
                      </td>
                      <td className="py-3.5 px-2 max-w-[240px]">
                        <div className="font-medium text-on-surface truncate">
                          {ord.product_name || ord.sku}
                        </div>
                        <div className="text-xs text-on-surface-variant truncate">
                          {ord.tenant_name || ord.tenant_id} · {ord.pack_quantity} boxes
                        </div>
                      </td>
                      <td className="py-3.5 px-2 text-right font-semibold text-on-surface whitespace-nowrap">
                        €{ord.total_eur.toFixed(2)}
                      </td>
                      <td className="py-3.5 pl-2 pr-5 text-right whitespace-nowrap text-xs font-medium">
                        {ord.status === 'CONFIRMED' ? (
                          <span className="inline-flex items-center gap-1 text-primary">
                            <CheckCheck className="w-3.5 h-3.5 shrink-0" />
                            <span>Confirmed</span>
                          </span>
                        ) : ord.status === 'PENDING_APPROVAL' ? (
                          <span className="inline-flex items-center gap-1 text-error">
                            <PauseCircle className="w-3.5 h-3.5 shrink-0" />
                            <span>Needs approval</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-on-surface-variant">
                            <XCircle className="w-3.5 h-3.5 shrink-0" />
                            <span>Declined</span>
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {filteredOrders.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-8 text-center text-sm text-on-surface-variant">
                      No orders match your current filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right: Order Details */}
        <div className="xl:col-span-5">
          {activeOrder ? (
            <div className="rounded-2xl bg-surface-container border border-outline-variant/50 p-6 space-y-5">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1 min-w-0">
                  <div className="text-xs text-on-surface-variant">
                    {activeOrder.tenant_name || activeOrder.tenant_id} · {activeOrder.order_id}
                  </div>
                  <h2 className="text-lg font-semibold text-on-surface font-headline">
                    {activeOrder.product_name || activeOrder.sku}
                  </h2>
                </div>
                <span className="text-lg font-semibold text-on-surface tabular-nums shrink-0">
                  €{activeOrder.total_eur.toFixed(2)}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-4 py-3 border-y border-outline-variant/40 text-xs tabular-nums">
                <div>
                  <div className="text-on-surface-variant">Quantity</div>
                  <div className="text-on-surface font-medium mt-0.5">
                    {activeOrder.pack_quantity} boxes ({activeOrder.total_litres} L)
                  </div>
                </div>
                <div>
                  <div className="text-on-surface-variant">Approval</div>
                  <div className="text-on-surface font-medium mt-0.5">
                    {activeOrder.approval_type === 'AUTO'
                      ? 'Automatic'
                      : activeOrder.approval_type === 'RECURRENT_WINDOW'
                      ? 'Multi-day window'
                      : activeOrder.approval_type === 'ONE_TIME'
                      ? 'Manager approved'
                      : 'Pending'}
                  </div>
                </div>
                <div>
                  <div className="text-on-surface-variant">Reference</div>
                  <div className="text-on-surface font-medium mt-0.5 truncate">
                    {activeOrder.po_reference}
                  </div>
                </div>
              </div>

              {activeOrder.violation_reasons && activeOrder.violation_reasons.length > 0 && (
                <div
                  className={`p-3.5 rounded-xl border text-xs ${
                    activeOrder.status === 'PENDING_APPROVAL'
                      ? 'bg-error-container/40 border-error/30 text-error'
                      : 'bg-surface-container-lowest border-outline-variant/40 text-on-surface-variant'
                  }`}
                >
                  <span className="font-medium text-on-surface">
                    {activeOrder.status === 'PENDING_APPROVAL'
                      ? 'Approval needed: '
                      : 'Manager sign-off reason: '}
                  </span>
                  {activeOrder.violation_reasons
                    .join(' · ')
                    .replace(/autonomous limit/gi, 'automatic limit')}
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => handleDownloadOrderReceipt(activeOrder)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-surface-container-high hover:bg-surface-container-highest text-on-surface text-xs font-medium transition-colors cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5 text-primary" />
                  <span>Download Receipt</span>
                </button>

                {activeOrder.status === 'PENDING_APPROVAL' && (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onRejectOrder(activeOrder.order_id)}
                      className="px-3.5 py-2 rounded-lg bg-error-container text-error text-xs font-medium hover:opacity-90 transition-opacity cursor-pointer"
                    >
                      Decline
                    </button>
                    <button
                      type="button"
                      onClick={() => onApproveOrder(activeOrder.order_id)}
                      className="px-3.5 py-2 rounded-lg bg-primary text-on-primary text-xs font-semibold hover:bg-primary-fixed transition-colors cursor-pointer"
                    >
                      Approve Order
                    </button>
                  </div>
                )}
              </div>

              {activeOrder.traces && activeOrder.traces.length > 0 && (
                <div className="pt-2 border-t border-outline-variant/40">
                  <button
                    type="button"
                    onClick={() => setShowSteps((s) => !s)}
                    className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline cursor-pointer"
                  >
                    {showSteps ? (
                      <ChevronDown className="w-4 h-4" />
                    ) : (
                      <ChevronRight className="w-4 h-4" />
                    )}
                    <span>
                      {showSteps ? 'Hide ordering steps' : `Show ordering steps (${activeOrder.traces.length})`}
                    </span>
                  </button>

                  {showSteps && (
                    <div className="mt-3 space-y-2.5">
                      {activeOrder.traces.map((step) => (
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
          ) : (
            <div className="rounded-2xl bg-surface-container border border-outline-variant/50 p-6 text-sm text-on-surface-variant">
              Select any order on the left to view its receipt and details.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
