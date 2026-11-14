import fs from 'node:fs/promises';
import path from 'node:path';
import {
  AimoGateStore,
  DEFAULT_TENANT_ID,
  GatewayError,
} from './aimogate.ts';
import { adminDb } from './firebase-admin.ts';
import type {
  AgentRunResponse,
  AuditLogEntry,
  CategoryRule,
  CategoryRuleUsageDTO,
  CustomerRosterItem,
  GuardrailWhitelistDTO,
  NetworkOverview,
  OrderDTO,
  Principal,
  Product,
  PublicOfferDTO,
  QuoteLock,
  RecurrentApprovalGrant,
  ScheduledPrompt,
  StockSummaryItem,
  SubstitutionRule,
  TenantPolicy,
  TokenBundle,
  WarehouseStock,
  ZeroTrustInspectResponse,
} from '../types/aimogate.ts';

const FALLBACK_SNAPSHOT_PATH = path.resolve('/tmp/aimogate-persistent-store.json');

interface SerializedSnapshot {
  initialized: boolean;
  killswitch_halted: boolean;
  audit_seq: number;
  id_counter: number;
  policies: TenantPolicy[];
  products: Product[];
  contract_prices: Array<{ id: string; tenant_id: string; sku: string; contract_pack_price_eur: number }>;
  warehouse_stock: WarehouseStock[];
  quote_locks: QuoteLock[];
  orders: OrderDTO[];
  recurrent_grants: RecurrentApprovalGrant[];
  scheduled_prompts: ScheduledPrompt[];
  audit_logs: AuditLogEntry[];
}

function cleanUndefined<T>(obj: T): T {
  if (obj === undefined) return null as unknown as T;
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) {
    return obj.map(cleanUndefined) as unknown as T;
  }
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) {
      result[k] = cleanUndefined(v);
    }
  }
  return result as T;
}

function isFirestoreAuthOrUnavailableError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes('PERMISSION_DENIED') ||
    msg.includes('Could not load the default credentials') ||
    msg.includes('UNAUTHENTICATED') ||
    msg.includes('UNAVAILABLE') ||
    msg.includes('NOT_FOUND') ||
    msg.includes('RESOURCE_EXHAUSTED') ||
    msg.includes('DEADLINE_EXCEEDED') ||
    msg.includes('ETIMEDOUT') ||
    msg.includes('ENOTFOUND') ||
    msg.includes('7 ')
  );
}

export class PersistentAimoGateStore {
  readonly engine = new AimoGateStore();
  private loadPromise: Promise<void> | null = null;
  private mutationQueue: Promise<unknown> = Promise.resolve();
  private useLocalFallback = false;
  private persistenceBackend: 'firestore' | 'local-fallback' = 'firestore';

  getBackendMode(): 'firestore' | 'local-fallback' {
    return this.persistenceBackend;
  }

  private exportSnapshot(): SerializedSnapshot {
    const counters = this.engine.getCounters();
    const contractPrices: SerializedSnapshot['contract_prices'] = [];
    for (const [key, price] of this.engine.contractPrices.entries()) {
      const [tenant_id, sku] = key.split('::');
      contractPrices.push({
        id: `${tenant_id}__${sku}`,
        tenant_id,
        sku,
        contract_pack_price_eur: price,
      });
    }
    return {
      initialized: true,
      killswitch_halted: this.engine.killswitchHalted,
      audit_seq: counters.audit_seq,
      id_counter: counters.id_counter,
      policies: Array.from(this.engine.policies.values()),
      products: Array.from(this.engine.products.values()),
      contract_prices: contractPrices,
      warehouse_stock: Array.from(this.engine.stock.values()),
      quote_locks: Array.from(this.engine.quoteLocks.values()),
      orders: Array.from(this.engine.orders.values()),
      recurrent_grants: Array.from(this.engine.grants.values()),
      scheduled_prompts: Array.from(this.engine.scheduledPrompts.values()),
      audit_logs: [...this.engine.auditLogs],
    };
  }

  private applySnapshot(snap: SerializedSnapshot): void {
    this.engine.policies.clear();
    for (const p of snap.policies) this.engine.policies.set(p.tenant_id, p);

    this.engine.products.clear();
    for (const p of snap.products) this.engine.products.set(p.sku, p);

    this.engine.contractPrices.clear();
    for (const cp of snap.contract_prices) {
      this.engine.contractPrices.set(`${cp.tenant_id}::${cp.sku}`, cp.contract_pack_price_eur);
    }

    this.engine.stock.clear();
    for (const s of snap.warehouse_stock) this.engine.stock.set(s.sku, s);

    this.engine.quoteLocks.clear();
    for (const q of snap.quote_locks) this.engine.quoteLocks.set(q.quote_id, q);

    this.engine.orders.clear();
    for (const o of snap.orders) this.engine.orders.set(o.order_id, o);

    this.engine.grants.clear();
    for (const g of snap.recurrent_grants) this.engine.grants.set(g.grant_id, g);

    this.engine.scheduledPrompts.clear();
    for (const sp of snap.scheduled_prompts) this.engine.scheduledPrompts.set(sp.schedule_id, sp);

    this.engine.auditLogs = [...snap.audit_logs].sort((a, b) => b.id - a.id);
    this.engine.killswitchHalted = Boolean(snap.killswitch_halted);
    this.engine.setCounters(snap.audit_seq || 1, snap.id_counter || 1000);
  }

  private async writeFullToFirestore(snap: SerializedSnapshot): Promise<void> {
    const batches: Array<ReturnType<typeof adminDb.batch>> = [];
    let currentBatch = adminDb.batch();
    let opCount = 0;

    const queueSet = (ref: FirebaseFirestore.DocumentReference, data: unknown) => {
      currentBatch.set(ref, cleanUndefined(data) as FirebaseFirestore.WithFieldValue<FirebaseFirestore.DocumentData>);
      opCount++;
      if (opCount >= 400) {
        batches.push(currentBatch);
        currentBatch = adminDb.batch();
        opCount = 0;
      }
    };

    for (const p of snap.policies) {
      queueSet(adminDb.collection('policies').doc(p.tenant_id), p);
    }
    for (const p of snap.products) {
      queueSet(adminDb.collection('products').doc(p.sku), p);
    }
    for (const cp of snap.contract_prices) {
      queueSet(adminDb.collection('contract_prices').doc(cp.id), cp);
    }
    for (const s of snap.warehouse_stock) {
      queueSet(adminDb.collection('warehouse_stock').doc(s.sku), s);
    }
    for (const q of snap.quote_locks) {
      queueSet(adminDb.collection('quote_locks').doc(q.quote_id), q);
    }
    for (const o of snap.orders) {
      queueSet(adminDb.collection('orders').doc(o.order_id), o);
    }
    for (const g of snap.recurrent_grants) {
      queueSet(adminDb.collection('recurrent_grants').doc(g.grant_id), g);
    }
    for (const sp of snap.scheduled_prompts) {
      queueSet(adminDb.collection('scheduled_prompts').doc(sp.schedule_id), sp);
    }
    for (const al of snap.audit_logs.slice(0, 100)) {
      queueSet(adminDb.collection('audit_logs').doc(String(al.id).padStart(8, '0')), al);
    }
    queueSet(adminDb.collection('system_config').doc('gateway'), {
      initialized: true,
      killswitch_halted: snap.killswitch_halted,
      audit_seq: snap.audit_seq,
      id_counter: snap.id_counter,
    });

    if (opCount > 0) {
      batches.push(currentBatch);
    }

    for (const b of batches) {
      await b.commit();
    }
  }

  private async readFullFromFirestore(): Promise<SerializedSnapshot | null> {
    const cfgSnap = await adminDb.collection('system_config').doc('gateway').get();
    if (!cfgSnap.exists || !cfgSnap.data()?.initialized) {
      return null;
    }
    const cfg = cfgSnap.data()!;
    const [
      policiesSnap,
      productsSnap,
      pricesSnap,
      stockSnap,
      quotesSnap,
      ordersSnap,
      grantsSnap,
      schedulesSnap,
      auditsSnap,
    ] = await Promise.all([
      adminDb.collection('policies').get(),
      adminDb.collection('products').get(),
      adminDb.collection('contract_prices').get(),
      adminDb.collection('warehouse_stock').get(),
      adminDb.collection('quote_locks').get(),
      adminDb.collection('orders').get(),
      adminDb.collection('recurrent_grants').get(),
      adminDb.collection('scheduled_prompts').get(),
      adminDb.collection('audit_logs').orderBy('id', 'desc').limit(150).get(),
    ]);

    return {
      initialized: true,
      killswitch_halted: Boolean(cfg.killswitch_halted),
      audit_seq: Number(cfg.audit_seq || 1),
      id_counter: Number(cfg.id_counter || 1000),
      policies: policiesSnap.docs.map((d) => d.data() as TenantPolicy),
      products: productsSnap.docs.map((d) => d.data() as Product),
      contract_prices: pricesSnap.docs.map(
        (d) =>
          d.data() as {
            id: string;
            tenant_id: string;
            sku: string;
            contract_pack_price_eur: number;
          }
      ),
      warehouse_stock: stockSnap.docs.map((d) => d.data() as WarehouseStock),
      quote_locks: quotesSnap.docs.map((d) => d.data() as QuoteLock),
      orders: ordersSnap.docs.map((d) => d.data() as OrderDTO),
      recurrent_grants: grantsSnap.docs.map((d) => d.data() as RecurrentApprovalGrant),
      scheduled_prompts: schedulesSnap.docs.map((d) => d.data() as ScheduledPrompt),
      audit_logs: auditsSnap.docs.map((d) => d.data() as AuditLogEntry),
    };
  }

  private async writeLocalFallback(snap: SerializedSnapshot): Promise<void> {
    await fs.writeFile(FALLBACK_SNAPSHOT_PATH, JSON.stringify(snap), 'utf8');
  }

  private async readLocalFallback(): Promise<SerializedSnapshot | null> {
    try {
      const raw = await fs.readFile(FALLBACK_SNAPSHOT_PATH, 'utf8');
      return JSON.parse(raw) as SerializedSnapshot;
    } catch {
      return null;
    }
  }

  async ensureLoaded(): Promise<void> {
    if (this.loadPromise) return this.loadPromise;
    this.loadPromise = (async () => {
      const hasGcpCreds = Boolean(
        process.env.GOOGLE_APPLICATION_CREDENTIALS ||
        process.env.K_SERVICE ||
        process.env.FUNCTION_TARGET ||
        process.env.FIRESTORE_EMULATOR_HOST
      );
      if (!hasGcpCreds) {
        this.useLocalFallback = true;
        this.persistenceBackend = 'local-fallback';
        const local = await this.readLocalFallback();
        if (local) {
          this.applySnapshot(local);
        } else {
          await this.writeLocalFallback(this.exportSnapshot());
        }
        return;
      }
      try {
        const existing = await this.readFullFromFirestore();
        if (existing) {
          this.applySnapshot(existing);
        } else {
          await this.writeFullToFirestore(this.exportSnapshot());
        }
        this.persistenceBackend = 'firestore';
        this.useLocalFallback = false;
      } catch (err) {
        if (!isFirestoreAuthOrUnavailableError(err)) {
          console.error('Firestore initialization error:', err);
        } else {
          console.warn(
            'Firestore Admin credentials unavailable in local sandbox; using local persistent fallback store until Cloud Run IAM is active.'
          );
        }
        this.useLocalFallback = true;
        this.persistenceBackend = 'local-fallback';
        const local = await this.readLocalFallback();
        if (local) {
          this.applySnapshot(local);
        } else {
          await this.writeLocalFallback(this.exportSnapshot());
        }
      }
    })();
    return this.loadPromise;
  }

  private async persistCurrentState(): Promise<void> {
    const snap = this.exportSnapshot();
    if (!this.useLocalFallback) {
      try {
        await this.writeFullToFirestore(snap);
        return;
      } catch (err) {
        console.warn('Firestore write failed, falling back to local persistent store:', err);
        this.useLocalFallback = true;
        this.persistenceBackend = 'local-fallback';
      }
    }
    try {
      await this.writeLocalFallback(snap);
    } catch (localErr) {
      console.error('Persistent local fallback store write failed:', localErr);
      throw new GatewayError(500, 'Persistent storage write failed.');
    }
  }

  private async persistReset(): Promise<void> {
    if (!this.useLocalFallback) {
      try {
        const collections = ['quote_locks', 'orders', 'recurrent_grants', 'scheduled_prompts', 'audit_logs'];
        for (const col of collections) {
          const docsSnap = await adminDb.collection(col).get();
          if (!docsSnap.empty) {
            const batch = adminDb.batch();
            for (const d of docsSnap.docs) batch.delete(d.ref);
            await batch.commit();
          }
        }
      } catch (err) {
        console.warn('Firestore reset notice, falling back to local store:', err);
        this.useLocalFallback = true;
        this.persistenceBackend = 'local-fallback';
      }
    }
    await this.persistCurrentState();
  }

  private enqueue<T>(fn: () => Promise<T> | T): Promise<T> {
    const next = this.mutationQueue.then(async () => {
      await this.ensureLoaded();
      return await fn();
    });
    this.mutationQueue = next.catch(() => undefined);
    return next;
  }

  async searchOffers(
    principal: Principal,
    req: {
      query?: string;
      attributes?: string[];
      required_volume_litres?: number;
      deliver_by?: string;
    }
  ): Promise<PublicOfferDTO[]> {
    await this.ensureLoaded();
    return this.engine.searchOffers(principal, req);
  }

  async lockQuote(
    principal: Principal,
    req: { sku: string; pack_quantity: number; deliver_by: string }
  ): Promise<QuoteLock> {
    return this.enqueue(async () => {
      const quote = this.engine.lockQuote(principal, req);
      await this.persistCurrentState();
      return quote;
    });
  }

  async commitOrder(
    principal: Principal,
    req: {
      quote_id: string;
      po_reference: string;
      traces?: OrderDTO['traces'];
      offer_comparisons?: OrderDTO['offer_comparisons'];
      items?: OrderDTO['items'];
      recipe_name?: OrderDTO['recipe_name'];
      substitution_request?: OrderDTO['substitution_request'];
    }
  ): Promise<OrderDTO> {
    return this.enqueue(async () => {
      const order = this.engine.commitOrder(principal, req);
      await this.persistCurrentState();
      return order;
    });
  }

  async approveOrder(
    principal: Principal,
    orderId: string,
    payload?: {
      approval_type?: 'ONE_TIME' | 'RECURRENT_WINDOW';
      window_days?: number;
      frequency?: 'DAILY' | 'WEEKLY' | 'MONTHLY';
      recurrent_budget_eur?: number;
      notes?: string;
    }
  ): Promise<OrderDTO> {
    return this.enqueue(async () => {
      const order = this.engine.approveOrder(principal, orderId, payload);
      await this.persistCurrentState();
      return order;
    });
  }

  async rejectOrder(principal: Principal, orderId: string): Promise<OrderDTO> {
    return this.enqueue(async () => {
      const order = this.engine.rejectOrder(principal, orderId);
      await this.persistCurrentState();
      return order;
    });
  }

  async acceptSubstitution(
    principal: Principal,
    orderId: string,
    payload?: { auto_create_rule?: boolean }
  ): Promise<OrderDTO> {
    return this.enqueue(async () => {
      const order = this.engine.acceptSubstitution(principal, orderId, payload);
      await this.persistCurrentState();
      return order;
    });
  }

  async rejectSubstitution(
    principal: Principal,
    orderId: string,
    payload?: { reason?: string }
  ): Promise<OrderDTO> {
    return this.enqueue(async () => {
      const order = this.engine.rejectSubstitution(principal, orderId, payload);
      await this.persistCurrentState();
      return order;
    });
  }

  async getSubstitutionRules(tenantId: string): Promise<SubstitutionRule[]> {
    return this.engine.getSubstitutionRules(tenantId);
  }

  async setSubstitutionRule(
    principal: Principal,
    tenantId: string,
    rule: Omit<SubstitutionRule, 'id' | 'created_at'>
  ): Promise<SubstitutionRule> {
    return this.enqueue(async () => {
      const newRule = this.engine.setSubstitutionRule(principal, tenantId, rule);
      await this.persistCurrentState();
      return newRule;
    });
  }

  async deleteSubstitutionRule(
    principal: Principal,
    tenantId: string,
    originalSku: string
  ): Promise<boolean> {
    return this.enqueue(async () => {
      const deleted = this.engine.deleteSubstitutionRule(principal, tenantId, originalSku);
      await this.persistCurrentState();
      return deleted;
    });
  }

  async updatePolicy(
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
  ): Promise<TenantPolicy> {
    return this.enqueue(async () => {
      const updated = this.engine.updatePolicy(principal, tenantId, patch);
      await this.persistCurrentState();
      return updated;
    });
  }

  async updateCategoryRule(
    principal: Principal,
    tenantId: string,
    category: string,
    patch: Partial<Omit<CategoryRule, 'category'>>
  ): Promise<CategoryRule> {
    return this.enqueue(async () => {
      const updated = this.engine.updateCategoryRule(principal, tenantId, category, patch);
      await this.persistCurrentState();
      return updated;
    });
  }

  async updateCustomerGuardrails(tenantId: string, allowedCategories: string[]): Promise<GuardrailWhitelistDTO> {
    return this.enqueue(async () => {
      const updated = this.engine.updateCustomerGuardrails(tenantId, allowedCategories);
      await this.persistCurrentState();
      return updated;
    });
  }

  async revokeGrant(grantId: string): Promise<{ status: string; grant_id: string }> {
    return this.enqueue(async () => {
      const res = this.engine.revokeGrant(grantId);
      await this.persistCurrentState();
      return res;
    });
  }

  async addSchedule(body: Record<string, unknown>): Promise<ScheduledPrompt> {
    return this.enqueue(async () => {
      const scheduleId = `SCH-${Math.random().toString(16).slice(2, 8).toUpperCase()}`;
      const item: ScheduledPrompt = {
        schedule_id: scheduleId,
        tenant_id: typeof body.tenant_id === 'string' ? body.tenant_id : DEFAULT_TENANT_ID,
        name: typeof body.name === 'string' && body.name.trim() ? body.name : 'Scheduled Procurement Directive',
        executor_agent: typeof body.executor_agent === 'string' ? body.executor_agent : 'buyer_agent_nordic_01',
        prompt: typeof body.prompt === 'string' ? body.prompt : '',
        strategy: (body.strategy === 'cron' || body.strategy === 'threshold' || body.strategy === 'one-time')
          ? body.strategy
          : 'cron',
        cron_expr: typeof body.cron_expr === 'string' ? body.cron_expr : '0 2 * * 2,5',
        next_run_label: typeof body.next_run_label === 'string' ? body.next_run_label : 'Next: Scheduled Cycle',
        max_cap_eur: Number(body.max_cap_eur || 800),
        require_multi_vendor: Boolean(body.require_multi_vendor ?? true),
        status: 'ACTIVE',
        last_run_summary: 'Deployed · awaiting next window',
        created_at: new Date().toISOString(),
      };
      this.engine.scheduledPrompts.set(scheduleId, item);
      this.engine.addAuditLog({
        tenant_id: item.tenant_id,
        actor_type: 'human',
        actor_id: 'manager_helsinki_01',
        action: 'SCHEDULED_PROMPT_DEPLOYED',
        payload_summary: { schedule_id: scheduleId, name: item.name, cron_expr: item.cron_expr },
      });
      await this.persistCurrentState();
      return item;
    });
  }

  async setKillswitch(halted: boolean): Promise<{ killswitch_halted: boolean }> {
    return this.enqueue(async () => {
      this.engine.killswitchHalted = halted;
      this.engine.addAuditLog({
        tenant_id: DEFAULT_TENANT_ID,
        actor_type: 'human',
        actor_id: 'elena_vance_vp',
        action: halted ? 'GLOBAL_KILLSWITCH_ARMED' : 'GLOBAL_KILLSWITCH_RELEASED',
        payload_summary: { killswitch_halted: halted },
      });
      await this.persistCurrentState();
      return { killswitch_halted: this.engine.killswitchHalted };
    });
  }

  async runAgentWorkflow(req: {
    prompt: string;
    mode?: string;
    po_reference?: string;
    tenant_id?: string;
  }): Promise<AgentRunResponse> {
    return this.enqueue(async () => {
      const res = this.engine.runAgentWorkflow(req);
      await this.persistCurrentState();
      return res;
    });
  }

  async persist(): Promise<void> {
    return this.enqueue(async () => {
      await this.persistCurrentState();
    });
  }

  async reset(): Promise<void> {
    return this.enqueue(async () => {
      this.engine.reset();
      await this.persistReset();
    });
  }

  async getOrders(tenantId?: string, statusFilter?: string): Promise<OrderDTO[]> {
    await this.ensureLoaded();
    return Array.from(this.engine.orders.values())
      .filter((o) => (!tenantId ? true : o.tenant_id === tenantId))
      .filter((o) => (!statusFilter ? true : o.status === statusFilter))
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  }

  async getPendingOrders(principal: Principal, tenantId?: string): Promise<OrderDTO[]> {
    await this.ensureLoaded();
    this.engine.requirePrincipal(principal, ['human', 'admin']);
    const target = tenantId || principal.tenant_id;
    return Array.from(this.engine.orders.values())
      .filter((o) => o.tenant_id === target && o.status === 'PENDING_APPROVAL')
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  }

  async getGrants(tenantId?: string): Promise<RecurrentApprovalGrant[]> {
    await this.ensureLoaded();
    return this.engine.listGrants(tenantId);
  }

  async getAuditLogs(tenantId?: string, limit = 100): Promise<AuditLogEntry[]> {
    await this.ensureLoaded();
    const list = tenantId
      ? this.engine.auditLogs.filter((l) => l.tenant_id === tenantId)
      : this.engine.auditLogs;
    return list.slice(0, limit);
  }

  async getPolicy(tenantId: string): Promise<TenantPolicy> {
    await this.ensureLoaded();
    const pol = this.engine.policies.get(tenantId);
    if (!pol) throw new GatewayError(404, `Policy for '${tenantId}' not found.`);
    return pol;
  }

  async getCustomerGuardrails(tenantId: string): Promise<GuardrailWhitelistDTO> {
    await this.ensureLoaded();
    return this.engine.getCustomerGuardrails(tenantId);
  }

  async getCategoryRules(tenantId: string): Promise<Record<string, CategoryRuleUsageDTO>> {
    await this.ensureLoaded();
    return this.engine.getCategoryRulesWithUsage(tenantId);
  }

  async getCategoryRule(tenantId: string, category: string): Promise<CategoryRuleUsageDTO> {
    await this.ensureLoaded();
    return this.engine.getCategoryRuleWithUsage(tenantId, category);
  }

  async getSchedules(tenantId?: string): Promise<ScheduledPrompt[]> {
    await this.ensureLoaded();
    return Array.from(this.engine.scheduledPrompts.values())
      .filter((s) => (!tenantId ? true : s.tenant_id === tenantId))
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  }

  async getTokenBundle(tenantId: string): Promise<TokenBundle> {
    await this.ensureLoaded();
    return this.engine.getTokenBundle(tenantId);
  }

  async inspectZeroTrustPayloads(tenantId: string): Promise<ZeroTrustInspectResponse> {
    await this.ensureLoaded();
    return this.engine.inspectZeroTrustPayloads(tenantId);
  }

  async getStockSummary(): Promise<StockSummaryItem[]> {
    await this.ensureLoaded();
    return this.engine.getStockSummary();
  }

  async getNetworkOverview(): Promise<NetworkOverview> {
    await this.ensureLoaded();
    return this.engine.getNetworkOverview();
  }

  async getCustomersRoster(): Promise<CustomerRosterItem[]> {
    await this.ensureLoaded();
    return this.engine.getCustomersRoster();
  }
}
