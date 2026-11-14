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
