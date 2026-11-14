import React, { useEffect, useRef, useState } from 'react';
import {
  UtensilsCrossed,
  CheckSquare,
  ShoppingBag,
  Sliders,
  ReceiptText,
  Search,
  Bell,
  User,
  RotateCcw,
  Menu,
  X,
  AlertTriangle,
  CheckCircle2,
  Store,
} from 'lucide-react';
import type {
  CustomerRosterItem,
  NavSectionId,
  NetworkOverview,
  OrderDTO,
} from '../types/aimogate';

interface ShellLayoutProps {
  activeNav: NavSectionId;
  onSelectNav: (nav: NavSectionId) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  selectedTenant: string;
  onTenantChange?: (tenantId: string) => void;
  customers: CustomerRosterItem[];
  pendingOrders: OrderDTO[];
  overview: NetworkOverview | null;
  onResetDemo: () => void;
  children: React.ReactNode;
}

const NAV_ITEMS: Array<{
  id: NavSectionId;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'procurement-guardrails', label: 'Allowed Items', icon: CheckSquare },
  { id: 'autonomous-prompt-scheduler', label: 'Orders & Approvals', icon: ShoppingBag },
  { id: 'safety-and-budget-limits', label: 'Spending Limits', icon: Sliders },
  { id: 'audit-and-agent-logs', label: 'Order History', icon: ReceiptText },
];

export const ShellLayout: React.FC<ShellLayoutProps> = ({
  activeNav,
  onSelectNav,
  searchQuery,
  onSearchChange,
  selectedTenant,
  onTenantChange,
  customers,
  pendingOrders,
  overview,
  onResetDemo,
  children,
}) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const currentCustomer = customers.find((c) => c.tenant_id === selectedTenant);
  const confirmedSpend = overview?.total_confirmed_spend_eur ?? 0;
  const spendGateMax = 10000;
  const spendPct = Math.min(100, Math.round((confirmedSpend / spendGateMax) * 1000) / 10);
  const isHalted = overview?.killswitch_halted ?? false;

  const sidebarContent = (
    <div className="flex flex-col justify-between h-full">
      <div className="flex flex-col">
        <div className="px-6 mb-8 flex items-center justify-between gap-2.5">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-surface-container-high border border-outline-variant/60 flex items-center justify-center text-primary shrink-0">
              <UtensilsCrossed className="w-4 h-4" />
            </div>
            <div className="flex flex-col min-w-0">
              <span className="text-base font-semibold tracking-tight text-on-surface font-headline whitespace-nowrap">
                AimoGate
              </span>
              <span className="text-xs text-on-surface-variant truncate">
                Valio Aimo Ordering
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setMobileMenuOpen(false)}
            aria-label="Close navigation menu"
            className="lg:hidden p-2 rounded-lg text-on-surface-variant hover:text-on-surface cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Restaurant Display */}
        <div className="px-5 mb-6">
          <div className="p-3 rounded-xl bg-surface-container border border-outline-variant/50 flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
              <Store className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <span className="block text-[11px] text-on-surface-variant font-medium">
                Restaurant
              </span>
              <span className="block text-sm font-semibold text-on-surface truncate">
                {currentCustomer?.tenant_name || 'Nordic Crown Hotels (Helsinki)'}
              </span>
            </div>
          </div>
        </div>

        <nav className="flex flex-col gap-1.5 px-3" aria-label="Main navigation">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeNav === item.id;
            const showBadge =
              item.id === 'autonomous-prompt-scheduler' && pendingOrders.length > 0;

            return (
              <button
                key={item.id}
                type="button"
                aria-current={active ? 'page' : undefined}
                onClick={() => {
                  onSelectNav(item.id);
                  setMobileMenuOpen(false);
                }}
                className={`flex items-center justify-between gap-2.5 px-3.5 py-2.5 rounded-xl text-sm text-left transition-colors cursor-pointer ${
                  active
                    ? 'bg-surface-container-high text-on-surface font-semibold border border-outline-variant/60'
                    : 'text-on-surface-variant hover:bg-surface-container-high/50 hover:text-on-surface border border-transparent'
                }`}
              >
                <span className="flex items-center gap-3 min-w-0">
                  <Icon
                    className={`w-[18px] h-[18px] shrink-0 ${
                      active ? 'text-primary' : 'text-on-surface-variant'
                    }`}
                  />
                  <span className="whitespace-nowrap truncate">{item.label}</span>
                </span>
                {showBadge && (
                  <span className="text-xs font-semibold tabular-nums text-error shrink-0">
                    {pendingOrders.length}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Quiet Monthly Spend Summary */}
      <div className="px-5 pt-6">
        <div className="p-4 rounded-xl bg-surface-container border border-outline-variant/50 flex flex-col gap-3">
          <div className="flex items-center justify-between text-xs">
            <span className="text-on-surface-variant font-medium">Monthly Spend</span>
            <span className="text-on-surface font-semibold tabular-nums">
              €{confirmedSpend.toLocaleString('en-US', { maximumFractionDigits: 0 })}
            </span>
          </div>
          <div className="w-full h-1.5 bg-surface-container-lowest rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all duration-300"
              style={{ width: `${spendPct}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-xs text-on-surface-variant tabular-nums">
            <span>of €{spendGateMax.toLocaleString()} budget</span>
            <span className={isHalted ? 'text-error font-medium' : 'text-primary font-medium'}>
              {isHalted ? 'Paused' : 'Active'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-background text-on-surface">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex fixed left-0 top-0 h-full w-68 bg-surface border-r border-outline-variant/40 z-40 flex-col pt-6 pb-6">
        {sidebarContent}
      </aside>

      {/* Mobile Drawer Sidebar */}
      {mobileMenuOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div
            className="fixed inset-0 bg-background/80 backdrop-blur-sm"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside className="relative w-72 max-w-[85vw] h-full bg-surface border-r border-outline-variant/60 z-10 flex flex-col pt-6 pb-6">
            {sidebarContent}
          </aside>
        </div>
      )}

      <div className="lg:pl-68">
        <header className="fixed top-0 left-0 lg:left-68 right-0 h-16 bg-surface/95 backdrop-blur-md border-b border-outline-variant/40 z-30 flex items-center justify-between px-4 sm:px-8 gap-4">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open navigation menu"
              className="lg:hidden p-2 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-colors cursor-pointer"
            >
              <Menu className="w-5 h-5" />
            </button>

            <div className="relative flex items-center max-w-sm w-full">
              <Search className="w-4 h-4 absolute left-3 text-on-surface-variant pointer-events-none" />
              <input
                ref={searchRef}
                type="text"
                aria-label="Search orders or supplies"
                value={searchQuery}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder="Search orders or supplies..."
                className="w-full h-10 bg-surface-container-lowest text-on-surface text-sm rounded-xl pl-9 pr-4 border border-outline-variant/50 focus:outline-none focus:border-primary/50 transition-colors placeholder:text-on-surface-variant/60"
              />
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={onResetDemo}
              title="Reset sample orders and limits"
              className="hidden sm:inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset Demo</span>
            </button>

            {/* Approval Bell */}
            <div className="relative">
              <button
                type="button"
                aria-label="Orders waiting for approval"
                onClick={() => setNotifOpen((prev) => !prev)}
                className="relative p-2.5 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-colors cursor-pointer"
              >
                <Bell className="w-5 h-5" />
                {pendingOrders.length > 0 && (
                  <span className="absolute top-1.5 right-1.5 min-w-[16px] h-4 px-1 rounded-full bg-error text-on-error text-[10px] font-bold tabular-nums flex items-center justify-center">
                    {pendingOrders.length}
                  </span>
                )}
              </button>

              {notifOpen && (
                <div className="absolute right-0 mt-2 w-80 rounded-xl bg-surface-container border border-outline-variant/60 shadow-2xl p-4 z-50 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-on-surface">
                      Waiting for Approval ({pendingOrders.length})
                    </span>
                    <button
                      type="button"
                      onClick={() => setNotifOpen(false)}
                      className="text-xs text-on-surface-variant hover:text-primary cursor-pointer"
                    >
                      Close
                    </button>
                  </div>
                  {pendingOrders.length === 0 ? (
                    <div className="flex items-center gap-2 text-xs text-on-surface-variant py-2">
                      <CheckCircle2 className="w-4 h-4 text-primary shrink-0" />
                      <span>
                        No orders need approval for {currentCustomer?.tenant_name}.
                      </span>
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-64 overflow-y-auto">
                      {pendingOrders.map((o) => (
                        <button
                          key={o.order_id}
                          type="button"
                          onClick={() => {
                            setNotifOpen(false);
                            onSelectNav('autonomous-prompt-scheduler');
                          }}
                          className="w-full text-left p-3 rounded-lg bg-surface-container-lowest hover:bg-surface-container-high border border-outline-variant/50 space-y-1 transition-colors cursor-pointer"
                        >
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-error font-medium flex items-center gap-1.5">
                              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                              Needs Sign-Off
                            </span>
                            <span className="text-on-surface font-semibold tabular-nums">
                              €{o.total_eur.toFixed(2)}
                            </span>
                          </div>
                          <div className="text-xs text-on-surface truncate">
                            {o.product_name || o.sku} · {o.pack_quantity} boxes
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="hidden sm:block h-5 w-[1px] bg-outline-variant/60" />

            <div className="hidden sm:flex items-center gap-3">
              <div className="flex flex-col text-right">
                <span className="text-sm font-medium text-on-surface leading-tight">
                  Elena Vance
                </span>
                <span className="text-xs text-on-surface-variant">
                  Kitchen &amp; Purchasing Manager
                </span>
              </div>
              <div className="w-9 h-9 rounded-full bg-surface-container-high border border-outline-variant/60 flex items-center justify-center text-primary">
                <User className="w-4 h-4" />
              </div>
            </div>
          </div>
        </header>

        <main className="relative pt-16 w-full min-h-screen bg-background">{children}</main>
      </div>
    </div>
  );
};
