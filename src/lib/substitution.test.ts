import assert from 'node:assert/strict';
import { AimoGateStore } from './aimogate.ts';
import type { Principal } from '../types/aimogate.ts';

async function runSubstitutionTests() {
  console.log('--- Testing Inventory Shortage & Substitution Request Workflow ---');

  const store = new AimoGateStore();

  const agentPrincipal: Principal = {
    tenant_id: 'hotel_nordic_group',
    principal_id: 'agent_procurement_bot',
    principal_type: 'agent',
    scopes: ['quotes:lock', 'orders:create', 'orders:read', 'policies:read'],
  };

  const humanPrincipal: Principal = {
    tenant_id: 'hotel_nordic_group',
    principal_id: 'kitchen_manager_annukka',
    principal_type: 'human',
    scopes: ['orders:approve', 'orders:reject', 'orders:read', 'policies:write', 'policies:update'],
  };

  // 1. Setup: simulate inventory shortage for Valio Eila 10L Bag-in-Box ('VA-LF-MILK-10L')
  const originalSku = 'VA-LF-MILK-10L';
  const origStock = store.stock.get(originalSku);
  assert.ok(origStock, 'Original stock record should exist');
  origStock.available_packs = 0; // Out of stock

  // Verify that policy initially has NO substitution rule for this SKU
  const policy = store.policies.get('hotel_nordic_group')!;
  if (policy.substitution_rules) {
    delete policy.substitution_rules[originalSku];
  }

  console.log('Test 1: Inventory shortage without rule generates SubstitutionRequestDTO and holds order');
  const shortageRes = store.runAgentWorkflow({
    prompt: 'Procure 200L of lactose-free milk by Friday morning.',
    tenant_id: 'hotel_nordic_group',
  });

  assert.equal(shortageRes.success, true, 'Workflow should succeed');
  assert.equal(shortageRes.final_status, 'PENDING_APPROVAL', 'Order must be held in PENDING_APPROVAL');
  assert.ok(shortageRes.order, 'Order should be created');
  assert.equal(shortageRes.order.status, 'PENDING_APPROVAL', 'Order status must be PENDING_APPROVAL');
  assert.ok(shortageRes.order.substitution_request, 'Order must attach a substitution_request');

  const subReq = shortageRes.order.substitution_request!;
  assert.equal(subReq.status, 'PENDING', 'Substitution request status must be PENDING');
  assert.equal(subReq.original_sku, originalSku, 'Original SKU must match requested item');
  assert.equal(subReq.available_packs, 0, 'Available packs must be 0');
  assert.notEqual(subReq.substitute_sku, originalSku, 'Substitute SKU must be a replacement item');
  assert.ok(subReq.substitute_packs > 0, 'Substitute packs must be > 0');
  assert.ok(typeof subReq.price_difference_eur === 'number', 'Price difference EUR must be a number');
  assert.ok(typeof subReq.price_difference_pct === 'number', 'Price difference pct must be a number');

  // Verify substitute quote was locked and inventory reserved
  const subQuote = store.quoteLocks.get(shortageRes.order.quote_id);
  assert.ok(subQuote, 'Substitute quote lock must exist');
  assert.equal(subQuote.status, 'LOCKED', 'Substitute quote must be in LOCKED state');
  assert.equal(subQuote.sku, subReq.substitute_sku, 'Locked quote must be for substitute SKU');

  // Verify audit log for substitution request
  const reqLogs = store.auditLogs.filter((l) => l.action === 'SUBSTITUTION_REQUESTED');
  assert.ok(reqLogs.length > 0, 'Must emit SUBSTITUTION_REQUESTED audit log');
  console.log('  ✓ Test 1 Passed: Generated SubstitutionRequestDTO held in PENDING_APPROVAL');

  console.log('Test 2: Human buyer accepts substitution with auto_create_rule = true');
  const acceptedOrder = store.acceptSubstitution(humanPrincipal, shortageRes.order.order_id, {
    auto_create_rule: true,
  });

  assert.equal(acceptedOrder.status, 'CONFIRMED', 'Accepted order must transition to CONFIRMED');
  assert.equal(acceptedOrder.substitution_request?.status, 'ACCEPTED', 'Substitution request must be ACCEPTED');
  assert.ok(acceptedOrder.approved_by?.includes('Substitution Accepted'), 'approved_by should note substitution');

  // Verify quote consumed
  const acceptedQuote = store.quoteLocks.get(acceptedOrder.quote_id);
  assert.equal(acceptedQuote?.status, 'CONSUMED', 'Substitute quote must be CONSUMED');

  // Verify rule was saved in tenant policy
  assert.ok(policy.substitution_rules, 'Policy substitution_rules must exist');
  const savedRule = policy.substitution_rules[originalSku];
  assert.ok(savedRule, 'Standing substitution rule must be saved for originalSku');
  assert.equal(savedRule.substitute_sku, subReq.substitute_sku, 'Saved rule must map to accepted substitute');
  assert.equal(savedRule.auto_approved, true, 'Rule must be auto_approved');

  // Verify audit logs
  const acceptedLogs = store.auditLogs.filter((l) => l.action === 'SUBSTITUTION_ACCEPTED');
  assert.ok(acceptedLogs.length > 0, 'Must emit SUBSTITUTION_ACCEPTED audit log');
  const ruleCreatedLogs = store.auditLogs.filter((l) => l.action === 'SUBSTITUTION_RULE_CREATED');
  assert.ok(ruleCreatedLogs.length > 0, 'Must emit SUBSTITUTION_RULE_CREATED audit log');
  console.log('  ✓ Test 2 Passed: Substitution accepted, stock consumed, standing rule created');

  console.log('Test 3: Subsequent shortage auto-substitutes seamlessly under standing rule');
  const autoSubRes = store.runAgentWorkflow({
    prompt: 'Procure 200L of lactose-free milk by Friday morning.',
    tenant_id: 'hotel_nordic_group',
  });

  assert.equal(autoSubRes.success, true, 'Workflow should succeed');
  assert.equal(autoSubRes.order?.status, 'CONFIRMED', 'Order should be AUTO-APPROVED under standing rule');
  assert.equal(autoSubRes.order?.sku, savedRule.substitute_sku, 'Order should be placed for substitute SKU');
  assert.equal(autoSubRes.order?.substitution_request, null, 'No human sign-off request needed under standing rule');
  console.log('  ✓ Test 3 Passed: Auto-substituted under pre-approved standing rule without review');

  console.log('Test 4: Buyer rejects substitution and stock is released');
  // Temporarily delete standing rule to test rejection
  delete policy.substitution_rules[originalSku];

  const rejectShortageRes = store.runAgentWorkflow({
    prompt: 'Procure 200L of lactose-free milk by Friday morning.',
    tenant_id: 'hotel_nordic_group',
  });

  assert.equal(rejectShortageRes.final_status, 'PENDING_APPROVAL');
  const rejectOrderId = rejectShortageRes.order!.order_id;
  const rejectQuoteId = rejectShortageRes.order!.quote_id;
  const subSku = rejectShortageRes.order!.substitution_request!.substitute_sku;
  const stockBeforeReject = store.stock.get(subSku)!.available_packs;

  const rejectedOrder = store.rejectSubstitution(humanPrincipal, rejectOrderId, {
    reason: 'Buyer refuses alternative milk product.',
  });

  assert.equal(rejectedOrder.status, 'REJECTED', 'Order status must be REJECTED');
  assert.equal(rejectedOrder.substitution_request?.status, 'REJECTED', 'Sub request status must be REJECTED');

  const releasedQuote = store.quoteLocks.get(rejectQuoteId);
  assert.equal(releasedQuote?.status, 'RELEASED', 'Substitute quote must be RELEASED');

  const stockAfterReject = store.stock.get(subSku)!.available_packs;
  assert.ok(stockAfterReject > stockBeforeReject, 'Reserved stock must be restored to available stock');

  const rejectLogs = store.auditLogs.filter((l) => l.action === 'SUBSTITUTION_REJECTED');
  assert.ok(rejectLogs.length > 0, 'Must emit SUBSTITUTION_REJECTED audit log');
  console.log('  ✓ Test 4 Passed: Substitution rejected, stock returned to inventory');

  console.log('Test 5: Substitution Rule Management API');
  const createdRule = store.setSubstitutionRule(humanPrincipal, 'hotel_nordic_group', {
    tenant_id: 'hotel_nordic_group',
    original_sku: 'VALIO-OAT-10L',
    original_name: 'Valio Oddlygood Barista Oat 10L',
    substitute_sku: 'VALIO-MILK-10L',
    substitute_name: 'Valio Eila 10L Bag-in-Box',
    auto_approved: true,
    max_price_increase_pct: 15,
  });
  assert.ok(createdRule.id.startsWith('SR-'), 'Rule ID should start with SR-');

  const rulesList = store.getSubstitutionRules('hotel_nordic_group');
  assert.ok(rulesList.some((r) => r.original_sku === 'VALIO-OAT-10L'), 'Rule must be in getSubstitutionRules');

  const deleted = store.deleteSubstitutionRule(humanPrincipal, 'hotel_nordic_group', 'VALIO-OAT-10L');
  assert.equal(deleted, true, 'Rule deletion must return true');
  const rulesListAfter = store.getSubstitutionRules('hotel_nordic_group');
  assert.ok(!rulesListAfter.some((r) => r.original_sku === 'VALIO-OAT-10L'), 'Rule must no longer exist');
  console.log('  ✓ Test 5 Passed: Rule CRUD operations verified');

  console.log('\nAll 5 Inventory Shortage & Substitution Tests Passed Perfectly!');
}

runSubstitutionTests().catch((err) => {
  console.error('Substitution test failure:', err);
  process.exit(1);
});
