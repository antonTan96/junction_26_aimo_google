import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_TENANT_ID } from './types/aimogate';
import type {
  AgentRunResponse,
  AuditLogEntry,
  CategoryRule,
  CustomerRosterItem,
  GuardrailWhitelistDTO,
  NavSectionId,
  NetworkOverview,
  OrderDTO,
  PrincipalType,
  RecurrentApprovalGrant,
  ScheduledPrompt,
  StockSummaryItem,
  TenantPolicy,
  TokenBundle,
  ZeroTrustInspectResponse,
} from './types/aimogate';
import { ShellLayout } from './components/ShellLayout';
import { ThreePaneControlPlane } from './components/ThreePaneControlPlane';
import { ProcurementGuardrailsView } from './components/ProcurementGuardrailsView';
import { PromptSchedulerView } from './components/PromptSchedulerView';
import { SafetyBudgetView } from './components/SafetyBudgetView';
import { AuditLogsView } from './components/AuditLogsView';
import { KillswitchModal, ZeroTrustModal } from './components/Modals';

const API_BASE = '/api/v1';

interface ToastState {
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
}

export default function App() {
  const [activeNav, setActiveNav] = useState<NavSectionId>('stage-demo');
  const [selectedTenant, setSelectedTenant] = useState<string>(DEFAULT_TENANT_ID);
  const role: PrincipalType = 'human';
  const [searchQuery, setSearchQuery] = useState('');

  const [tokens, setTokens] = useState<TokenBundle | null>(null);
  const [customers, setCustomers] = useState<CustomerRosterItem[]>([
    {
      tenant_id: DEFAULT_TENANT_ID,
      tenant_name: 'Nordic Crown Hotels (Helsinki)',
      max_auto_approve_eur: 800,
      max_auto_approve_litres: 600,
      allowed_categories: ['dairy', 'plant-based'],
      restricted_categories: ['bakery', 'beverages', 'cleaning', 'meat', 'alcohol'],
      active_grants_count: 0,
      total_orders: 0,
      pending_approvals: 0,
      confirmed_orders: 0,
      total_confirmed_spend_eur: 0,
      agent_status: 'ONLINE',
    },
  ]);
  const [overview, setOverview] = useState<NetworkOverview | null>(null);
  const [policy, setPolicy] = useState<TenantPolicy>({
    tenant_id: DEFAULT_TENANT_ID,
    tenant_name: 'Nordic Crown Hotels (Helsinki)',
    max_auto_approve_eur: 800,
    max_auto_approve_litres: 600,
    allowed_categories: ['dairy', 'plant-based'],
    anomaly_sensitivity_pct: 82,
    auto_dispute_enabled: true,
  });
  const [guardrails, setGuardrails] = useState<GuardrailWhitelistDTO | null>(null);
  const [orders, setOrders] = useState<OrderDTO[]>([]);
  const [allOrders, setAllOrders] = useState<OrderDTO[]>([]);
  const [recurrentGrants, setRecurrentGrants] = useState<RecurrentApprovalGrant[]>([]);
  const [scheduledPrompts, setScheduledPrompts] = useState<ScheduledPrompt[]>([]);
  const [stock, setStock] = useState<StockSummaryItem[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [globalAuditLogs, setGlobalAuditLogs] = useState<AuditLogEntry[]>([]);
  const [zeroTrustData, setZeroTrustData] = useState<ZeroTrustInspectResponse | null>(null);

  const [agentResponse, setAgentResponse] = useState<AgentRunResponse | null>(null);
  const [isRunningAgent, setIsRunningAgent] = useState(false);

  const [killswitchModalOpen, setKillswitchModalOpen] = useState(false);
  const [zeroTrustModalOpen, setZeroTrustModalOpen] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);

  const showToast = useCallback((message: string, type: ToastState['type'] = 'info') => {
    setToast({ message, type });
    setTimeout(() => {
      setToast((prev) => (prev?.message === message ? null : prev));
    }, 4500);
  }, []);

  const authFetch = useCallback(
    async (url: string, options: RequestInit = {}) => {
      const token = tokens?.[role]?.token || `aimo.${role}.${selectedTenant}`;
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...((options.headers as Record<string, string>) || {}),
      };
      return fetch(url, { ...options, headers });
    },
    [tokens, role, selectedTenant]
  );

  const refreshAllData = useCallback(
    async (tenantId: string = selectedTenant) => {
      try {
        const [
          tRes,
          cRes,
          oRes,
          pRes,
          gRes,
          ordRes,
          allOrdRes,
          rgRes,
          schRes,
          stRes,
          alRes,
          galRes,
          ztRes,
        ] = await Promise.all([
          fetch(`${API_BASE}/demo/tokens?tenant_id=${tenantId}`),
          fetch(`${API_BASE}/admin/customers`),
          fetch(`${API_BASE}/admin/overview`),
          fetch(`${API_BASE}/policies?tenant_id=${tenantId}`),
          fetch(`${API_BASE}/policies/guardrails?tenant_id=${tenantId}`),
          fetch(`${API_BASE}/orders?tenant_id=${tenantId}`),
          fetch(`${API_BASE}/admin/orders`),
          fetch(`${API_BASE}/orders/recurrent-grants?tenant_id=${tenantId}`),
          fetch(`${API_BASE}/schedules?tenant_id=${tenantId}`),
          fetch(`${API_BASE}/demo/stock`),
          fetch(`${API_BASE}/orders/audit/logs`, {
            headers: { Authorization: `Bearer aimo.human.${tenantId}` },
          }),
          fetch(`${API_BASE}/admin/audit_logs`),
          fetch(`${API_BASE}/demo/inspect?tenant_id=${tenantId}`),
        ]);

        if (tRes.ok) setTokens(await tRes.json());
        if (cRes.ok) {
          const allCustomers: CustomerRosterItem[] = await cRes.json();
          const myCustomer = allCustomers.filter((c) => c.tenant_id === DEFAULT_TENANT_ID);
          setCustomers(myCustomer.length > 0 ? myCustomer : allCustomers.slice(0, 1));
        }
        if (oRes.ok) setOverview(await oRes.json());
        if (pRes.ok) setPolicy(await pRes.json());
        if (gRes.ok) setGuardrails(await gRes.json());
        if (ordRes.ok) setOrders(await ordRes.json());
        if (allOrdRes.ok) setAllOrders(await allOrdRes.json());
        if (rgRes.ok) setRecurrentGrants(await rgRes.json());
        if (schRes.ok) setScheduledPrompts(await schRes.json());
        if (stRes.ok) setStock(await stRes.json());
        if (alRes.ok) setAuditLogs(await alRes.json());
        if (galRes.ok) setGlobalAuditLogs(await galRes.json());
        if (ztRes.ok) setZeroTrustData(await ztRes.json());
      } catch (err) {
        console.error('Failed to sync AimoGate state:', err);
      }
    },
    [selectedTenant]
  );

  useEffect(() => {
    refreshAllData(selectedTenant);
  }, [selectedTenant, refreshAllData]);

  const handleResetDemo = async () => {
    const res = await fetch(`${API_BASE}/demo/reset`, { method: 'POST' });
    if (res.ok) {
      setAgentResponse(null);
      await refreshAllData(selectedTenant);
      showToast('Sample orders and limits restored.', 'success');
    }
  };

  const handleToggleCategory = async (category: string) => {
    const currentAllowed = guardrails?.allowed_categories ?? policy.allowed_categories;
    let updated: string[];
    if (currentAllowed.includes(category)) {
      if (currentAllowed.length <= 1) {
        showToast('At least one category must stay enabled.', 'warning');
        return;
      }
      updated = currentAllowed.filter((c) => c !== category);
    } else {
      updated = [...currentAllowed, category];
    }

    const res = await fetch(`${API_BASE}/admin/customers/${selectedTenant}/guardrails`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ allowed_categories: updated }),
    });
    if (res.ok) {
      await refreshAllData(selectedTenant);
      showToast('Allowed item categories updated.', 'success');
    }
  };

  const handleUpdatePolicy = async (patch: Partial<TenantPolicy>) => {
    const res = await authFetch(`${API_BASE}/policies?tenant_id=${selectedTenant}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
    if (res.ok) {
      const updated = await res.json();
      setPolicy(updated);
      await refreshAllData(selectedTenant);
      showToast(
        `Spending limits saved: €${updated.max_auto_approve_eur} / ${updated.max_auto_approve_litres}L`,
        'success'
      );
    } else {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      showToast(`Could not save limits (${res.status}): ${err.detail}`, 'error');
    }
  };

  const handleUpdateCategoryRule = async (
    category: string,
    patch: Partial<Omit<CategoryRule, 'category'>>
  ) => {
    const res = await authFetch(
      `${API_BASE}/policies/categories/${category}?tenant_id=${selectedTenant}`,
      {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }
    );
    if (res.ok) {
      await refreshAllData(selectedTenant);
      showToast(
        `Guardrail rule updated for ${category.toUpperCase()}`,
        'success'
      );
    } else {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      showToast(`Could not update category rule (${res.status}): ${err.detail}`, 'error');
      throw new Error(err.detail || 'Failed to update category rule');
    }
  };

  const handleRunAgent = async (prompt: string, mode: string) => {
    setIsRunningAgent(true);
    setAgentResponse(null);
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 18000);
      let res: Response;
      try {
        res = await fetch(`${API_BASE}/agent/run`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt,
            mode,
            tenant_id: selectedTenant,
          }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }

      if (res.ok) {
        const data: AgentRunResponse = await res.json();
        setAgentResponse(data);
        try {
          await refreshAllData(selectedTenant);
        } catch (refreshErr) {
          console.warn('Background sync error after agent run:', refreshErr);
        }
        if (data.final_status === 'CONFIRMED') {
          showToast(`Order ${data.order?.order_id} confirmed automatically!`, 'success');
        } else if (data.final_status === 'INFORMATIONAL') {
          showToast('Inquiry answered with live data. No order placed.', 'info');
        } else {
          showToast(
            `Order ${data.order?.order_id} is held — waiting for your approval.`,
            'warning'
          );
        }
      } else {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        showToast(`Order check failed: ${err.detail}`, 'error');
      }
    } catch (err: any) {
      showToast(`Order execution notice: ${err?.message || 'Processing completed'}`, 'warning');
    } finally {
      setIsRunningAgent(false);
    }
  };

  const handleDeploySchedule = async (payload: {
    name: string;
    prompt: string;
    strategy: 'cron' | 'threshold' | 'one-time';
    cron_expr: string;
    max_cap_eur: number;
    require_multi_vendor: boolean;
  }) => {
    const res = await fetch(`${API_BASE}/schedules`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...payload,
        tenant_id: selectedTenant,
        next_run_label:
          payload.strategy === 'cron'
            ? payload.cron_expr === '0 6 * * 1'
              ? 'Every Monday at 06:00'
              : payload.cron_expr === '0 5 * * *'
              ? 'Every morning at 05:00'
              : 'Every Tue & Fri at 02:00'
            : payload.strategy === 'threshold'
            ? 'Runs when stock gets low'
            : 'One-time order',
      }),
    });
    if (res.ok) {
      await refreshAllData(selectedTenant);
      showToast(`Recurring order "${payload.name}" saved.`, 'success');
    }
  };

  const handleApproveOrder = async (
    orderId: string,
    approvalType: 'ONE_TIME' | 'RECURRENT_WINDOW' = 'ONE_TIME',
    windowDays = 7,
    budget = 3000
  ) => {
    const res = await authFetch(`${API_BASE}/orders/${orderId}/approve?tenant_id=${selectedTenant}`, {
      method: 'POST',
      body: JSON.stringify({
        approval_type: approvalType,
        window_days: windowDays,
        frequency: 'WEEKLY',
        recurrent_budget_eur: budget,
      }),
    });
    if (res.ok) {
      await refreshAllData(selectedTenant);
      showToast(
        approvalType === 'RECURRENT_WINDOW'
          ? `Order ${orderId} confirmed and pre-approved for ${windowDays} days.`
          : `Order ${orderId} confirmed.`,
        'success'
      );
    } else {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      showToast(`Approval blocked (${res.status}): ${err.detail}`, 'error');
    }
  };

  const handleRejectOrder = async (orderId: string) => {
    const res = await authFetch(`${API_BASE}/orders/${orderId}/reject?tenant_id=${selectedTenant}`, {
      method: 'POST',
    });
    if (res.ok) {
      await refreshAllData(selectedTenant);
      showToast(`Order ${orderId} declined and held stock released.`, 'warning');
    } else {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      showToast(`Action blocked (${res.status}): ${err.detail}`, 'error');
    }
  };

  const handleAcceptSubstitution = async (orderId: string, autoCreateRule = false) => {
    const res = await authFetch(`${API_BASE}/orders/${orderId}/substitution/accept?tenant_id=${selectedTenant}`, {
      method: 'POST',
      body: JSON.stringify({ auto_create_rule: autoCreateRule }),
    });
    if (res.ok) {
      await refreshAllData(selectedTenant);
      showToast(
        autoCreateRule
          ? `Substitution accepted and standing pre-approved rule saved for future orders.`
          : `Substitution accepted for order ${orderId}.`,
        'success'
      );
    } else {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      showToast(`Action failed (${res.status}): ${err.detail}`, 'error');
    }
  };

  const handleRejectSubstitution = async (orderId: string, reason?: string) => {
    const res = await authFetch(`${API_BASE}/orders/${orderId}/substitution/reject?tenant_id=${selectedTenant}`, {
      method: 'POST',
      body: JSON.stringify({ reason: reason || 'Substitution declined by buyer' }),
    });
    if (res.ok) {
      await refreshAllData(selectedTenant);
      showToast(`Substitution rejected. Order ${orderId} cancelled and reserved stock released.`, 'warning');
    } else {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      showToast(`Action failed (${res.status}): ${err.detail}`, 'error');
    }
  };

  const handleRevokeGrant = async (grantId: string) => {
    const res = await fetch(`${API_BASE}/admin/recurrent-grants/${grantId}/revoke`, {
      method: 'POST',
    });
    if (res.ok) {
      await refreshAllData(selectedTenant);
      showToast('Pre-approval window stopped.', 'warning');
    }
  };

  const handleToggleKillswitch = async () => {
    const nextHalted = !(overview?.killswitch_halted ?? false);
    const res = await fetch(`${API_BASE}/admin/killswitch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ halted: nextHalted }),
    });
    if (res.ok) {
      await refreshAllData(selectedTenant);
      showToast(
        nextHalted
          ? 'Automatic ordering paused for your restaurant.'
          : 'Automatic ordering resumed.',
        nextHalted ? 'error' : 'success'
      );
    }
  };

  const currentCustomer =
    customers.find((c) => c.tenant_id === selectedTenant) || customers[0];
  const pendingOrders = orders.filter((o) => o.status === 'PENDING_APPROVAL');

  return (
    <>
      <ShellLayout
        activeNav={activeNav}
        onSelectNav={setActiveNav}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        selectedTenant={selectedTenant}
        customers={customers}
        pendingOrders={pendingOrders}
        overview={overview}
        onResetDemo={handleResetDemo}
      >
        {/* Toast Banner */}
        {toast && (
          <div
            role={toast.type === 'error' ? 'alert' : 'status'}
            className={`fixed top-20 right-6 z-50 max-w-md px-4 py-3 rounded-xl border shadow-2xl backdrop-blur-xl text-xs font-medium flex items-center gap-3 ${
              toast.type === 'error'
                ? 'bg-error-container/95 border-error/50 text-on-error-container'
                : toast.type === 'success'
                ? 'bg-primary-container/95 border-primary/50 text-on-primary-container'
                : toast.type === 'warning'
                ? 'bg-tertiary-container/95 border-tertiary/50 text-on-tertiary-container'
                : 'bg-surface-container-high/95 border-primary/30 text-on-surface'
            }`}
          >
            <span className="flex-1">{toast.message}</span>
            <button
              type="button"
              onClick={() => setToast(null)}
              className="text-[11px] underline opacity-80 hover:opacity-100 cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        )}

        {activeNav === 'stage-demo' && (
          <ThreePaneControlPlane
            customer={currentCustomer}
            policy={policy}
            orders={orders}
            pendingOrders={pendingOrders}
            auditLogs={auditLogs}
            globalAuditLogs={globalAuditLogs}
            zeroTrustData={zeroTrustData}
            agentResponse={agentResponse}
            isRunningAgent={isRunningAgent}
            onRunAgent={handleRunAgent}
            onUpdatePolicy={handleUpdatePolicy}
            onApproveOrder={handleApproveOrder}
            onRejectOrder={handleRejectOrder}
            onAcceptSubstitution={handleAcceptSubstitution}
            onRejectSubstitution={handleRejectSubstitution}
            onResetDemo={handleResetDemo}
          />
        )}

        {activeNav === 'procurement-guardrails' && (
          <ProcurementGuardrailsView
            customer={currentCustomer}
            policy={policy}
            guardrails={guardrails}
            orders={orders}
            auditLogs={auditLogs}
            globalSearch={searchQuery}
            onToggleCategory={handleToggleCategory}
            onUpdateCategoryRule={handleUpdateCategoryRule}
            onPublishPolicies={() =>
              showToast(
                `Published strict policy snapshot for ${currentCustomer.tenant_name}.`,
                'success'
              )
            }
            onOpenZeroTrustModal={() => setZeroTrustModalOpen(true)}
            onNavigate={setActiveNav}
          />
        )}

        {activeNav === 'autonomous-prompt-scheduler' && (
          <PromptSchedulerView
            customers={customers}
            selectedTenant={selectedTenant}
            policy={policy}
            pendingOrders={pendingOrders}
            recurrentGrants={recurrentGrants}
            scheduledPrompts={scheduledPrompts}
            stock={stock}
            agentResponse={agentResponse}
            isRunningAgent={isRunningAgent}
            onRunAgent={handleRunAgent}
            onDeploySchedule={handleDeploySchedule}
            onApproveOrder={handleApproveOrder}
            onRejectOrder={handleRejectOrder}
            onAcceptSubstitution={handleAcceptSubstitution}
            onRejectSubstitution={handleRejectSubstitution}
            onRevokeGrant={handleRevokeGrant}
          />
        )}

        {activeNav === 'safety-and-budget-limits' && (
          <SafetyBudgetView
            customer={currentCustomer}
            policy={policy}
            overview={overview}
            orders={orders}
            onUpdatePolicy={handleUpdatePolicy}
            onOpenKillswitchModal={() => setKillswitchModalOpen(true)}
            onNavigate={setActiveNav}
          />
        )}

        {activeNav === 'audit-and-agent-logs' && (
          <AuditLogsView
            customers={customers}
            allOrders={allOrders}
            globalAuditLogs={globalAuditLogs}
            overview={overview}
            policy={policy}
            globalSearch={searchQuery}
            onApproveOrder={(id) => handleApproveOrder(id, 'ONE_TIME')}
            onRejectOrder={handleRejectOrder}
            onOpenZeroTrustModal={() => setZeroTrustModalOpen(true)}
          />
        )}
      </ShellLayout>

      <KillswitchModal
        open={killswitchModalOpen}
        isHalted={overview?.killswitch_halted ?? false}
        onClose={() => setKillswitchModalOpen(false)}
        onConfirm={handleToggleKillswitch}
      />

      <ZeroTrustModal
        open={zeroTrustModalOpen}
        data={zeroTrustData}
        onClose={() => setZeroTrustModalOpen(false)}
      />
    </>
  );
}
