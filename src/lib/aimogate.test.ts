import test from 'node:test';
import assert from 'node:assert/strict';
import { AimoGateStore, GatewayError, DEFAULT_TENANT_ID, evaluateOrderPolicy } from './aimogate.ts';
import type { CategoryRule, TenantPolicy, Product, QuoteLock } from '../types/aimogate.ts';

test('AC-1: search_offers returns unit-normalized offers and strips confidential & unreleased fields', () => {
  const store = new AimoGateStore();
  const agent = store.getPresetPrincipal('agent', DEFAULT_TENANT_ID);
  const deliverBy = new Date(Date.now() + 3 * 86400_000).toISOString();

  const offers = store.searchOffers(agent, {
    query: 'lactose-free milk',
    required_volume_litres: 1000,
    deliver_by: deliverBy,
  });

  assert.equal(offers.length, 2);
  const skus = offers.map((o) => o.sku);
  assert.ok(skus.includes('VA-LF-MILK-10L'));
  assert.ok(skus.includes('VA-LF-MILK-12X1L'));
  assert.ok(!skus.includes('VA-ROADMAP-Q4-PRO'));

  const o10 = offers.find((o) => o.sku === 'VA-LF-MILK-10L')!;
  assert.equal(o10.packs_required, 100);
  assert.equal(o10.delivered_volume_litres, 1000);
  assert.equal(o10.total_contract_price_eur, 1180);
  assert.equal(o10.price_per_litre_eur, 1.18);

  const o12 = offers.find((o) => o.sku === 'VA-LF-MILK-12X1L')!;
  assert.equal(o12.packs_required, 84);
  assert.equal(o12.delivered_volume_litres, 1008);
  assert.equal(o12.total_contract_price_eur, 1300.32);

  for (const o of offers) {
    assert.equal('internal_margin_pct' in o, false);
    assert.equal('internal_cost_eur' in o, false);
    assert.equal('roadmap_status' in o, false);
  }
});

test('AC-2: lock_quote reserves stock and commit_order holds high-value order in PENDING_APPROVAL', () => {
  const store = new AimoGateStore();
  const agent = store.getPresetPrincipal('agent', DEFAULT_TENANT_ID);
  const deliverBy = new Date(Date.now() + 3 * 86400_000).toISOString();

  const quote = store.lockQuote(agent, {
    sku: 'VA-LF-MILK-10L',
    pack_quantity: 100,
    deliver_by: deliverBy,
  });

  assert.equal(quote.locked_total_eur, 1180);
  const stock = store.stock.get('VA-LF-MILK-10L')!;
  assert.equal(stock.available_packs, 150);
  assert.equal(stock.reserved_packs, 100);

  const order = store.commitOrder(agent, {
    quote_id: quote.quote_id,
    po_reference: 'PO-TEST-AC2',
  });

  assert.equal(order.status, 'PENDING_APPROVAL');
  assert.ok(order.violation_reasons?.some((r) => r.includes('exceeds autonomous limit')));
  assert.equal(store.stock.get('VA-LF-MILK-10L')!.reserved_packs, 100);
});

test('AC-3: agent principal is strictly forbidden (403) from approving or rejecting orders', () => {
  const store = new AimoGateStore();
  const agent = store.getPresetPrincipal('agent', DEFAULT_TENANT_ID);
  const deliverBy = new Date(Date.now() + 3 * 86400_000).toISOString();

  const quote = store.lockQuote(agent, {
    sku: 'VA-LF-MILK-10L',
    pack_quantity: 100,
    deliver_by: deliverBy,
  });
  const order = store.commitOrder(agent, {
    quote_id: quote.quote_id,
    po_reference: 'PO-TEST-AC3',
  });

  assert.throws(
    () => store.approveOrder(agent, order.order_id),
    (err: unknown) => err instanceof GatewayError && err.status === 403
  );
  assert.throws(
    () => store.rejectOrder(agent, order.order_id),
    (err: unknown) => err instanceof GatewayError && err.status === 403
  );
});

test('AC-4: human approval finalizes order and consumes reserved stock; rejection releases stock', () => {
  const store = new AimoGateStore();
  const agent = store.getPresetPrincipal('agent', DEFAULT_TENANT_ID);
  const human = store.getPresetPrincipal('human', DEFAULT_TENANT_ID);
  const deliverBy = new Date(Date.now() + 3 * 86400_000).toISOString();

  const q1 = store.lockQuote(agent, { sku: 'VA-LF-MILK-10L', pack_quantity: 100, deliver_by: deliverBy });
  const o1 = store.commitOrder(agent, { quote_id: q1.quote_id, po_reference: 'PO-AC4-APP' });
  const approved = store.approveOrder(human, o1.order_id);

  assert.equal(approved.status, 'CONFIRMED');
  assert.equal(store.stock.get('VA-LF-MILK-10L')!.available_packs, 150);
  assert.equal(store.stock.get('VA-LF-MILK-10L')!.reserved_packs, 0);

  const q2 = store.lockQuote(agent, { sku: 'VA-LF-MILK-10L', pack_quantity: 80, deliver_by: deliverBy });
  const o2 = store.commitOrder(agent, { quote_id: q2.quote_id, po_reference: 'PO-AC4-REJ' });
  const rejected = store.rejectOrder(human, o2.order_id);

  assert.equal(rejected.status, 'REJECTED');
  assert.equal(store.stock.get('VA-LF-MILK-10L')!.available_packs, 150);
  assert.equal(store.stock.get('VA-LF-MILK-10L')!.reserved_packs, 0);
});

test('AC-5: 400L order auto-approves, and raising spend cap to €1,500 auto-approves 1,000L order', () => {
  const store = new AimoGateStore();
  const agent = store.getPresetPrincipal('agent', DEFAULT_TENANT_ID);
  const human = store.getPresetPrincipal('human', DEFAULT_TENANT_ID);
  const deliverBy = new Date(Date.now() + 3 * 86400_000).toISOString();

  const q400 = store.lockQuote(agent, { sku: 'VA-LF-MILK-10L', pack_quantity: 40, deliver_by: deliverBy });
  assert.equal(q400.locked_total_eur, 472);
  const o400 = store.commitOrder(agent, { quote_id: q400.quote_id, po_reference: 'PO-AC5-400' });
  assert.equal(o400.status, 'CONFIRMED');

  store.updatePolicy(human, DEFAULT_TENANT_ID, {
    max_auto_approve_eur: 1500,
    max_auto_approve_litres: 1500,
  });

  const q1000 = store.lockQuote(agent, { sku: 'VA-LF-MILK-10L', pack_quantity: 100, deliver_by: deliverBy });
  const o1000 = store.commitOrder(agent, { quote_id: q1000.quote_id, po_reference: 'PO-AC5-1000' });
  assert.equal(o1000.status, 'CONFIRMED');
});

test('Guardrail category whitelist blocks non-whitelisted bakery croissants until whitelisted', () => {
  const store = new AimoGateStore();
  const res1 = store.runAgentWorkflow({
    prompt: 'I need 20 boxes of artisanal butter croissants by Monday.',
    tenant_id: DEFAULT_TENANT_ID,
  });
  assert.equal(res1.final_status, 'PENDING_APPROVAL');
  assert.ok(res1.order?.violation_reasons?.some((r) => r.includes('GUARDRAIL BLOCKED')));

  store.updateCustomerGuardrails(DEFAULT_TENANT_ID, ['dairy', 'plant-based', 'bakery']);
  const res2 = store.runAgentWorkflow({
    prompt: 'I need 10 boxes of artisanal butter croissants by Monday.',
    tenant_id: DEFAULT_TENANT_ID,
  });
  assert.equal(res2.final_status, 'CONFIRMED');
});

test('Recurrent approval window allows subsequent orders until revoked, and killswitch halts fleet', () => {
  const store = new AimoGateStore();
  const human = store.getPresetPrincipal('human', DEFAULT_TENANT_ID);

  const run1 = store.runAgentWorkflow({
    prompt: 'I need 1,000 litres of lactose-free milk by Monday.',
    tenant_id: DEFAULT_TENANT_ID,
  });
  assert.doesNotThrow(() => JSON.stringify(run1));
  assert.equal(run1.final_status, 'PENDING_APPROVAL');

  const approved = store.approveOrder(human, run1.order!.order_id, {
    approval_type: 'RECURRENT_WINDOW',
    window_days: 7,
    recurrent_budget_eur: 3500,
  });
  assert.ok(approved.recurrent_grant_id);

  const run2 = store.runAgentWorkflow({
    prompt: 'I need 1,000 litres of lactose-free milk by Monday.',
    tenant_id: DEFAULT_TENANT_ID,
  });
  assert.equal(run2.final_status, 'CONFIRMED');
  assert.equal(run2.order?.approval_type, 'RECURRENT_WINDOW');

  store.revokeGrant(approved.recurrent_grant_id!);
  store.killswitchHalted = true;
  const run3 = store.runAgentWorkflow({
    prompt: 'I need 400 litres of lactose-free milk by Monday.',
    tenant_id: DEFAULT_TENANT_ID,
  });
  assert.equal(run3.final_status, 'PENDING_APPROVAL');
  assert.ok(run3.order?.violation_reasons?.some((r) => r.includes('KILLSWITCH')));
});

test('Category time configuration: 1000L of milk/dairy weekly auto-approves within limit and holds in PENDING_APPROVAL when exceeded', () => {
  const store = new AimoGateStore();
  const agent = store.getPresetPrincipal('agent', DEFAULT_TENANT_ID);
  const human = store.getPresetPrincipal('human', DEFAULT_TENANT_ID);

  // Set spend cap to €5000 so spend cap does not mask the weekly 1000L category storage limit
  store.updatePolicy(human, DEFAULT_TENANT_ID, {
    max_auto_approve_eur: 5000,
  });

  const baseTime = new Date('2026-11-01T10:00:00.000Z');
  const deliverBy1 = new Date(baseTime.getTime() + 2 * 86400_000).toISOString();

  // Order 1: 60 packs of 10L = 600L on Day 0 -> auto-approves (within 1000L weekly limit)
  const q1 = store.lockQuote(agent, { sku: 'VA-LF-MILK-10L', pack_quantity: 60, deliver_by: deliverBy1 }, baseTime);
  const o1 = store.commitOrder(agent, { quote_id: q1.quote_id, po_reference: 'PO-WEEKLY-600L' }, baseTime);
  assert.equal(o1.status, 'CONFIRMED');
  assert.equal(o1.approval_type, 'AUTO');

  // Check usage at Day 1: 600L consumed in period
  const tDay1 = new Date('2026-11-02T10:00:00.000Z');
  const usage1 = store.getCategoryRuleWithUsage(DEFAULT_TENANT_ID, 'dairy', tDay1);
  assert.equal(usage1.current_period_consumed_litres, 600);
  assert.equal(usage1.max_storage_litres, 1000);
  assert.equal(usage1.time_window, 'weekly');
  assert.equal(usage1.is_expired, false);

  // Order 2: 40 packs of 10L = 400L on Day 1 -> brings cumulative total to 1000L -> auto-approves
  const deliverBy2 = new Date(tDay1.getTime() + 2 * 86400_000).toISOString();
  const q2 = store.lockQuote(agent, { sku: 'VA-LF-MILK-10L', pack_quantity: 40, deliver_by: deliverBy2 }, tDay1);
  const o2 = store.commitOrder(agent, { quote_id: q2.quote_id, po_reference: 'PO-WEEKLY-400L' }, tDay1);
  assert.equal(o2.status, 'CONFIRMED');
  assert.equal(o2.approval_type, 'AUTO');

  // Check usage at Day 2: 1000L consumed in period
  const tDay2 = new Date('2026-11-03T10:00:00.000Z');
  const usage2 = store.getCategoryRuleWithUsage(DEFAULT_TENANT_ID, 'dairy', tDay2);
  assert.equal(usage2.current_period_consumed_litres, 1000);

  // Order 3: 1 pack of 10L = 10L on Day 2 -> brings period volume to 1010L > 1000L -> PENDING_APPROVAL
  const deliverBy3 = new Date(tDay2.getTime() + 2 * 86400_000).toISOString();
  const q3 = store.lockQuote(agent, { sku: 'VA-LF-MILK-10L', pack_quantity: 1, deliver_by: deliverBy3 }, tDay2);
  const o3 = store.commitOrder(agent, { quote_id: q3.quote_id, po_reference: 'PO-WEEKLY-EXCEED-10L' }, tDay2);
  assert.equal(o3.status, 'PENDING_APPROVAL');
  assert.ok(
    o3.violation_reasons?.some((r) =>
      r.includes("Weekly storage limit exceeded for category 'dairy': Order brings period volume to 1010.0L, exceeding limit of 1000.0L/week. Requires human approval.")
    )
  );

  // Human approval finalizes the held order
  const approvedOrder3 = store.approveOrder(human, o3.order_id);
  assert.equal(approvedOrder3.status, 'CONFIRMED');

  // Advance time to Day 8 (after 7 days from Day 0 order 1)
  // Window is now [Day 1, Day 8], so Day 0 order (600L) rolls out of the 7-day window.
  // Active window volume is now: Day 1 (400L) + Day 2 (10L) = 410L.
  const tDay8 = new Date('2026-11-09T10:00:00.000Z');
  const usage8 = store.getCategoryRuleWithUsage(DEFAULT_TENANT_ID, 'dairy', tDay8);
  assert.equal(usage8.current_period_consumed_litres, 410);

  // Order 4: 50 packs of 10L = 500L on Day 8 -> brings period volume to 410 + 500 = 910L <= 1000L -> auto-approves!
  const deliverBy4 = new Date(tDay8.getTime() + 2 * 86400_000).toISOString();
  const q4 = store.lockQuote(agent, { sku: 'VA-LF-MILK-10L', pack_quantity: 50, deliver_by: deliverBy4 }, tDay8);
  const o4 = store.commitOrder(agent, { quote_id: q4.quote_id, po_reference: 'PO-WEEKLY-ROLLING-500L' }, tDay8);
  assert.equal(o4.status, 'CONFIRMED');
});

test('Category rule time limit: Orders while rule is valid auto-approve without repeated approvals; expired rule requires human approval', () => {
  const store = new AimoGateStore();
  const agent = store.getPresetPrincipal('agent', DEFAULT_TENANT_ID);
  const human = store.getPresetPrincipal('human', DEFAULT_TENANT_ID);

  store.updatePolicy(human, DEFAULT_TENANT_ID, {
    max_auto_approve_eur: 5000,
  });

  const tBase = new Date('2026-11-01T10:00:00.000Z');
  const tExpiry = new Date('2026-11-08T10:00:00.000Z'); // Valid for 7 days

  // Configure category rule with valid_until = 7 days
  store.updateCategoryRule(human, DEFAULT_TENANT_ID, 'dairy', {
    time_window: 'weekly',
    max_storage_litres: 1000,
    rule_valid_until: tExpiry.toISOString(),
  });

  // Check rule before expiration (Day 3)
  const tDay3 = new Date('2026-11-04T10:00:00.000Z');
  const usageBefore = store.getCategoryRuleWithUsage(DEFAULT_TENANT_ID, 'dairy', tDay3);
  assert.equal(usageBefore.is_expired, false);
  assert.equal(usageBefore.days_remaining, 4);

  // Order placed at Day 3 auto-approves without human intervention
  const deliverBy1 = new Date(tDay3.getTime() + 2 * 86400_000).toISOString();
  const q1 = store.lockQuote(agent, { sku: 'VA-LF-MILK-10L', pack_quantity: 20, deliver_by: deliverBy1 }, tDay3);
  const o1 = store.commitOrder(agent, { quote_id: q1.quote_id, po_reference: 'PO-VALID-RULE' }, tDay3);
  assert.equal(o1.status, 'CONFIRMED');
  assert.equal(o1.approval_type, 'AUTO');

  // Check rule after expiration (Day 9 > Day 7 expiry)
  const tDay9 = new Date('2026-11-10T10:00:00.000Z');
  const usageAfter = store.getCategoryRuleWithUsage(DEFAULT_TENANT_ID, 'dairy', tDay9);
  assert.equal(usageAfter.is_expired, true);
  assert.equal(usageAfter.days_remaining, 0);

  // Order placed at Day 9 is held in PENDING_APPROVAL due to expiration
  const deliverBy2 = new Date(tDay9.getTime() + 2 * 86400_000).toISOString();
  const q2 = store.lockQuote(agent, { sku: 'VA-LF-MILK-10L', pack_quantity: 20, deliver_by: deliverBy2 }, tDay9);
  const o2 = store.commitOrder(agent, { quote_id: q2.quote_id, po_reference: 'PO-EXPIRED-RULE' }, tDay9);
  assert.equal(o2.status, 'PENDING_APPROVAL');
  assert.ok(
    o2.violation_reasons?.some((r) =>
      r.includes(`Category rule for 'dairy' has expired on ${tExpiry.toISOString()}. Human approval required.`)
    )
  );

  // Human approves the expired order
  const approvedExpired = store.approveOrder(human, o2.order_id);
  assert.equal(approvedExpired.status, 'CONFIRMED');

  // Owner extends the rule validity to Day 30
  const tNewExpiry = new Date('2026-12-01T10:00:00.000Z');
  store.updateCategoryRule(human, DEFAULT_TENANT_ID, 'dairy', {
    rule_valid_until: tNewExpiry.toISOString(),
  });

  // Subsequent order now auto-approves again without requiring repeated approvals
  const tDay10 = new Date('2026-11-11T10:00:00.000Z');
  const deliverBy3 = new Date(tDay10.getTime() + 2 * 86400_000).toISOString();
  const q3 = store.lockQuote(agent, { sku: 'VA-LF-MILK-10L', pack_quantity: 20, deliver_by: deliverBy3 }, tDay10);
  const o3 = store.commitOrder(agent, { quote_id: q3.quote_id, po_reference: 'PO-EXTENDED-RULE' }, tDay10);
  assert.equal(o3.status, 'CONFIRMED');
  assert.equal(o3.approval_type, 'AUTO');
});

test('Category rule updates via store/API: access control, validation, and usage reporting', () => {
  const store = new AimoGateStore();
  const agent = store.getPresetPrincipal('agent', DEFAULT_TENANT_ID);
  const human = store.getPresetPrincipal('human', DEFAULT_TENANT_ID);

  // 1. Agent principal is forbidden (403) from updating category rules
  assert.throws(
    () =>
      store.updateCategoryRule(agent, DEFAULT_TENANT_ID, 'dairy', {
        max_storage_litres: 2000,
      }),
    (err: unknown) => err instanceof GatewayError && err.status === 403
  );

  // 2. Human principal successfully updates category rule
  const updated = store.updateCategoryRule(human, DEFAULT_TENANT_ID, 'dairy', {
    time_window: 'daily',
    max_storage_litres: 300,
    rule_valid_until: null,
  });
  assert.equal(updated.category, 'dairy');
  assert.equal(updated.time_window, 'daily');
  assert.equal(updated.max_storage_litres, 300);
  assert.equal(updated.rule_valid_until, null);

  // Verify getCategoryRuleWithUsage returns updated settings
  const usage = store.getCategoryRuleWithUsage(DEFAULT_TENANT_ID, 'dairy');
  assert.equal(usage.time_window, 'daily');
  assert.equal(usage.max_storage_litres, 300);
  assert.equal(usage.rule_valid_until, null);
  assert.equal(usage.is_expired, false);
  assert.equal(usage.days_remaining, null);

  // 3. Invalid time_window throws 400 Bad Request
  assert.throws(
    () =>
      store.updateCategoryRule(human, DEFAULT_TENANT_ID, 'dairy', {
        time_window: 'hourly' as any,
      }),
    (err: unknown) => err instanceof GatewayError && err.status === 400
  );

  // 4. Audit log records CATEGORY_RULE_UPDATED
  const ruleLog = store.auditLogs.find((l) => l.action === 'CATEGORY_RULE_UPDATED');
  assert.ok(ruleLog);
  assert.equal(ruleLog.tenant_id, DEFAULT_TENANT_ID);
  assert.equal(ruleLog.actor_type, 'human');
  assert.equal((ruleLog.payload_summary as any).category, 'dairy');
});

test('evaluateOrderPolicy: direct unit evaluation across windows and constraints', () => {
  const policy: TenantPolicy = {
    tenant_id: 'tenant_test',
    tenant_name: 'Test Tenant',
    max_auto_approve_eur: 5000,
    max_auto_approve_litres: 2000,
    allowed_categories: ['dairy'],
    anomaly_sensitivity_pct: 10,
    auto_dispute_enabled: false,
    category_rules: {
      dairy: {
        category: 'dairy',
        time_window: 'daily',
        max_storage_litres: 200,
        rule_valid_until: '2026-11-20T00:00:00.000Z',
      },
    },
  };

  const product: Product = {
    sku: 'VA-LF-MILK-10L',
    name: 'Test Milk',
    category: 'dairy',
    dietary_tags: [],
    pack_format: '10L',
    pack_volume_litres: 10,
    min_lead_time_hours: 24,
    is_active: true,
    internal_cost_eur: 8,
    internal_margin_pct: 20,
    roadmap_status: 'LIVE',
  };

  const quote: QuoteLock = {
    quote_id: 'Q-TEST',
    tenant_id: 'tenant_test',
    sku: 'VA-LF-MILK-10L',
    pack_quantity: 15,
    total_litres: 150,
    locked_total_eur: 180,
    deliver_by: '2026-11-15T12:00:00.000Z',
    status: 'LOCKED',
    expires_at: '2026-11-15T12:15:00.000Z',
    created_at: '2026-11-15T12:00:00.000Z',
  };

  // 1. Within daily limit of 200L (150L ordered) -> passes
  const res1 = evaluateOrderPolicy({
    policy,
    product,
    quote,
    now: new Date('2026-11-15T12:00:00.000Z'),
  });
  assert.equal(res1.passes, true);
  assert.equal(res1.violations.length, 0);

  // 2. Exceeds daily limit (150L past order within 24 hours + 150L quote = 300L > 200L) -> fails
  const res2 = evaluateOrderPolicy({
    policy,
    product,
    quote,
    existingOrders: [
      {
        order_id: 'ORD-PAST-1',
        quote_id: 'Q-PAST-1',
        tenant_id: 'tenant_test',
        po_reference: 'PO-PAST',
        status: 'CONFIRMED',
        total_eur: 180,
        violation_reasons: null,
        approved_by: 'auto',
        approval_type: 'AUTO',
        recurrent_grant_id: null,
        created_at: '2026-11-15T06:00:00.000Z', // 6 hours ago
        sku: 'VA-LF-MILK-10L',
        category: 'dairy',
        pack_quantity: 15,
        total_litres: 150,
      },
    ],
    now: new Date('2026-11-15T12:00:00.000Z'),
  });
  assert.equal(res2.passes, false);
  assert.ok(res2.violations.some((v) => v.includes("Daily storage limit exceeded for category 'dairy'")));

  // 3. Expired rule -> fails with expiration violation
  const res3 = evaluateOrderPolicy({
    policy,
    product,
    quote,
    now: new Date('2026-11-25T12:00:00.000Z'), // Past rule_valid_until (Nov 20)
  });
  assert.equal(res3.passes, false);
  assert.ok(res3.violations.some((v) => v.includes("Category rule for 'dairy' has expired on")));
});
