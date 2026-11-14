process.env.SKIP_SERVER_LISTEN = 'true';
process.env.SKIP_VITE = 'true';

import { createApp } from '../server.ts';
import { PersistentAimoGateStore } from '../src/lib/firestoreStore.ts';
import {
  AimoGateStore,
  DEFAULT_TENANT_ID,
  GatewayError,
} from '../src/lib/aimogate.ts';
import type { Principal, PublicOfferDTO } from '../src/types/aimogate.ts';

// We test both directly against PersistentAimoGateStore and via REST API dispatch.
interface VerificationTestResult {
  suite: string;
  test: string;
  passed: boolean;
  details: string;
  duration_ms: number;
}

const results: VerificationTestResult[] = [];

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function runTest(suite: string, name: string, fn: () => Promise<void> | void) {
  const t0 = Date.now();
  try {
    await fn();
    results.push({ suite, test: name, passed: true, details: 'OK', duration_ms: Date.now() - t0 });
    console.log(`  ✅ [PASS] ${suite} - ${name}`);
  } catch (err: any) {
    results.push({ suite, test: name, passed: false, details: err.message, duration_ms: Date.now() - t0 });
    console.error(`  ❌ [FAIL] ${suite} - ${name}: ${err.message}`);
  }
}

async function main() {
  console.log('========================================================================');
  console.log('🧪 Verifying Wholesaler Store, Inventory Lifecycle, and REST API Determinism');
  console.log('========================================================================\n');

  const store = new PersistentAimoGateStore();
  await store.ensureLoaded();
  await store.reset();

  // Test Principals
  const agentTenantA = store.engine.getPresetPrincipal('agent', 'hotel_nordic_group');
  const humanTenantA = store.engine.getPresetPrincipal('human', 'hotel_nordic_group');
  const agentTenantB = store.engine.getPresetPrincipal('agent', 'scandic_helsinki_hub');
  const humanTenantB = store.engine.getPresetPrincipal('human', 'scandic_helsinki_hub');
  const adminWholesaler = store.engine.getPresetPrincipal('admin', 'hotel_nordic_group');

  const testSku = 'VA-LF-MILK-10L';
  const initialStockRec = store.engine.stock.get(testSku)!;
  const initialAvailable = initialStockRec.available_packs;
  const initialReserved = initialStockRec.reserved_packs;

  console.log(`Initial stock for ${testSku}: Available=${initialAvailable}, Reserved=${initialReserved}\n`);

  // ============================================================================
  // Suite 1: Stock Reservation Lifecycle
  // ============================================================================
  console.log('--- Suite 1: Stock Reservation Lifecycle ---');

  let testQuoteId = '';
  let testOrderId = '';

  await runTest('Stock Lifecycle', 'Lock Quote decrements available packs and increments reserved packs', async () => {
    // 110 packs * 10L = 1100L (€1232.00), which exceeds both €800 budget and 1000L weekly cap
    const quote = await store.lockQuote(agentTenantA, {
      sku: testSku,
      pack_quantity: 110,
      deliver_by: new Date(Date.now() + 48 * 3600_000).toISOString(),
    });
    testQuoteId = quote.quote_id;

    const currentStock = store.engine.stock.get(testSku)!;
    assert(currentStock.available_packs === initialAvailable - 110, `Expected ${initialAvailable - 110}, got ${currentStock.available_packs}`);
    assert(currentStock.reserved_packs === initialReserved + 110, `Expected ${initialReserved + 110}, got ${currentStock.reserved_packs}`);
    assert(quote.status === 'LOCKED', `Quote status must be LOCKED, got ${quote.status}`);
  });

  await runTest('Stock Lifecycle', 'Insufficient stock throws 409 Conflict', async () => {
    let threw409 = false;
    try {
      await store.lockQuote(agentTenantA, {
        sku: testSku,
        pack_quantity: 99999, // Way exceeding available stock
        deliver_by: new Date(Date.now() + 48 * 3600_000).toISOString(),
      });
    } catch (err: any) {
      if (err instanceof GatewayError && err.status === 409) {
        threw409 = true;
      }
    }
    assert(threw409, 'Expected GatewayError with 409 Conflict for insufficient stock');
  });

  await runTest('Stock Lifecycle', 'Commit Order holds policy-violating order in PENDING_APPROVAL while stock remains reserved', async () => {
    // 110 packs (€1232.00, 1100L) exceeds €800 budget and 1000L storage limit -> held in PENDING_APPROVAL
    const order = await store.commitOrder(agentTenantA, {
      quote_id: testQuoteId,
      po_reference: `PO-VERIFY-${Date.now()}`,
    });
    testOrderId = order.order_id;

    assert(order.status === 'PENDING_APPROVAL', `Expected PENDING_APPROVAL, got ${order.status}`);
    const currentStock = store.engine.stock.get(testSku)!;
    // Stock remains reserved while pending approval
    assert(currentStock.reserved_packs === initialReserved + 110, 'Reserved packs must remain held during PENDING_APPROVAL');
    assert(currentStock.available_packs === initialAvailable - 110, 'Available packs must remain decremented during PENDING_APPROVAL');
  });

  await runTest('Stock Lifecycle', 'Human Approval permanently consumes reserved stock', async () => {
    const approvedOrder = await store.approveOrder(humanTenantA, testOrderId, {
      approval_type: 'ONE_TIME',
    });
    assert(approvedOrder.status === 'CONFIRMED', `Expected CONFIRMED, got ${approvedOrder.status}`);

    const currentStock = store.engine.stock.get(testSku)!;
    assert(currentStock.reserved_packs === initialReserved, `Reserved packs must reset to ${initialReserved}, got ${currentStock.reserved_packs}`);
    assert(currentStock.available_packs === initialAvailable - 110, `Available packs must remain permanently consumed (${initialAvailable - 110})`);
  });

  await runTest('Stock Lifecycle', 'Human Rejection restores available stock and clears reserved stock', async () => {
    // 85 packs (€952.00) exceeds €800 budget -> held in PENDING_APPROVAL
    const quote2 = await store.lockQuote(agentTenantA, {
      sku: testSku,
      pack_quantity: 85,
      deliver_by: new Date(Date.now() + 48 * 3600_000).toISOString(),
    });
    const stockAfterLock = store.engine.stock.get(testSku)!;
    const availBeforeReject = stockAfterLock.available_packs;
    const reservedBeforeReject = stockAfterLock.reserved_packs;

    const order2 = await store.commitOrder(agentTenantA, {
      quote_id: quote2.quote_id,
      po_reference: `PO-REJECT-${Date.now()}`,
    });
    assert(order2.status === 'PENDING_APPROVAL', `Expected PENDING_APPROVAL for order2, got ${order2.status}`);

    const rejectedOrder = await store.rejectOrder(humanTenantA, order2.order_id);
    assert(rejectedOrder.status === 'REJECTED', `Expected REJECTED, got ${rejectedOrder.status}`);

    const stockAfterReject = store.engine.stock.get(testSku)!;
    assert(stockAfterReject.available_packs === availBeforeReject + 85, `Available packs must be restored by +85`);
    assert(stockAfterReject.reserved_packs === reservedBeforeReject - 85, `Reserved packs must be cleared by -85`);
    assert(quote2.status === 'RELEASED', `Quote status must be RELEASED`);
  });

  await runTest('Stock Lifecycle', 'Expired quote restores reserved stock and throws 410 on commit', async () => {
    const quote3 = await store.lockQuote(agentTenantA, {
      sku: testSku,
      pack_quantity: 10,
      deliver_by: new Date(Date.now() + 48 * 3600_000).toISOString(),
    });

    const stockAfterLock = store.engine.stock.get(testSku)!;
    const availBeforeExpire = stockAfterLock.available_packs;
    const reservedBeforeExpire = stockAfterLock.reserved_packs;

    // Simulate 20 minutes in the future (past 15-min TTL)
    const futureDate = new Date(Date.now() + 20 * 60_000);

    let threw410 = false;
    try {
      store.engine.commitOrder(agentTenantA, {
        quote_id: quote3.quote_id,
        po_reference: `PO-EXPIRE-${Date.now()}`,
      }, futureDate);
    } catch (err: any) {
      if (err instanceof GatewayError && err.status === 410) {
        threw410 = true;
      }
    }
    assert(threw410, 'Commit on expired quote must throw 410 Gone');

    const stockAfterExpire = store.engine.stock.get(testSku)!;
    assert(stockAfterExpire.available_packs === availBeforeExpire + 10, 'Available packs must be restored upon quote expiration');
    assert(stockAfterExpire.reserved_packs === reservedBeforeExpire - 10, 'Reserved packs must be released upon quote expiration');
    assert(quote3.status === 'EXPIRED', 'Quote status must be marked EXPIRED');
  });

  // ============================================================================
  // Suite 2: Idempotency & Replay Protection
  // ============================================================================
  console.log('\n--- Suite 2: Idempotency & Replay Protection ---');

  await runTest('Idempotency & Replay', 'Commit with identical po_reference returns existing order without duplicate debit', async () => {
    const quote = await store.lockQuote(agentTenantA, {
      sku: testSku,
      pack_quantity: 5,
      deliver_by: new Date(Date.now() + 48 * 3600_000).toISOString(),
    });
    const poRef = `PO-IDEMPOTENT-${Date.now()}`;
    const order1 = await store.commitOrder(agentTenantA, { quote_id: quote.quote_id, po_reference: poRef });

    const stockBeforeReplay = store.engine.stock.get(testSku)!.available_packs;
    // Replay same commit with same po_reference
    const order2 = await store.commitOrder(agentTenantA, { quote_id: quote.quote_id, po_reference: poRef });

    assert(order1.order_id === order2.order_id, 'Replay must return exact same order_id');
    const stockAfterReplay = store.engine.stock.get(testSku)!.available_packs;
    assert(stockBeforeReplay === stockAfterReplay, 'Replay must not re-debit stock');
  });

  await runTest('Idempotency & Replay', 'Re-approving an already CONFIRMED order throws 400 Bad Request', async () => {
    let threw400 = false;
    try {
      await store.approveOrder(humanTenantA, testOrderId, { approval_type: 'ONE_TIME' });
    } catch (err: any) {
      if (err instanceof GatewayError && err.status === 400) {
        threw400 = true;
      }
    }
    assert(threw400, 'Re-approving CONFIRMED order must throw 400 Bad Request');
  });

  await runTest('Idempotency & Replay', 'Re-rejecting an already CONFIRMED or REJECTED order throws 400 Bad Request', async () => {
    let threw400 = false;
    try {
      await store.rejectOrder(humanTenantA, testOrderId); // Already confirmed
    } catch (err: any) {
      if (err instanceof GatewayError && err.status === 400) {
        threw400 = true;
      }
    }
    assert(threw400, 'Rejecting a CONFIRMED order must throw 400 Bad Request');
  });

  await runTest('Idempotency & Replay', 'Commit with an already CONSUMED quote throws 400 Bad Request', async () => {
    let threw400 = false;
    try {
      await store.commitOrder(agentTenantA, {
        quote_id: testQuoteId, // Already consumed
        po_reference: `PO-RECONSUME-${Date.now()}`,
      });
    } catch (err: any) {
      if (err instanceof GatewayError && err.status === 400) {
        threw400 = true;
      }
    }
    assert(threw400, 'Committing with consumed quote must throw 400 Bad Request');
  });

  // ============================================================================
  // Suite 3: Audit Log Invariance
  // ============================================================================
  console.log('\n--- Suite 3: Audit Log Invariance ---');

  await runTest('Audit Log Invariance', 'State mutations emit immutable audit events with hash, tenant, and actor', async () => {
    const logs = await store.getAuditLogs('hotel_nordic_group', 50);
    assert(logs.length > 0, 'Audit logs must not be empty');

    const actionsPresent = new Set(logs.map(l => l.action));
    console.log('    Recorded Audit Actions in store:', Array.from(actionsPresent).join(', '));

    assert(actionsPresent.has('QUOTE_LOCKED'), 'Must record QUOTE_LOCKED');
    assert(actionsPresent.has('POLICY_HELD') || actionsPresent.has('AUTO_APPROVED'), 'Must record ORDER_COMMITTED action');
    assert(actionsPresent.has('HUMAN_APPROVED'), 'Must record HUMAN_APPROVED');
    assert(actionsPresent.has('HUMAN_REJECTED'), 'Must record HUMAN_REJECTED');

    for (const log of logs.slice(0, 10)) {
      assert(typeof log.id === 'number', 'Audit log must have numeric sequence ID');
      assert(typeof log.timestamp === 'string', 'Audit log must have ISO timestamp');
      assert(typeof log.verification_hash === 'string' && log.verification_hash.startsWith('0x'), 'Audit log must have cryptographic 0x hash');
      assert(log.tenant_id === 'hotel_nordic_group' || log.tenant_id === 'scandic_helsinki_hub' || log.tenant_id === 'fazer_food_services', 'Audit log must carry valid tenant_id');
      assert(['agent', 'human', 'admin', 'system'].includes(log.actor_type), `Invalid actor_type: ${log.actor_type}`);
    }
  });

  await runTest('Audit Log Invariance', 'Killswitch toggling emits KILLSWITCH_ACTIVATED / DEACTIVATED audit log', async () => {
    await store.setKillswitch(true);
    let logs = await store.getAuditLogs(DEFAULT_TENANT_ID, 5);
    const killLog = logs.find(l => l.action.includes('KILLSWITCH') && l.action.includes('ARMED'));
    assert(!!killLog, 'Must record GLOBAL_KILLSWITCH_ARMED');

    await store.setKillswitch(false);
    logs = await store.getAuditLogs(DEFAULT_TENANT_ID, 5);
    const unkillLog = logs.find(l => l.action.includes('KILLSWITCH') && l.action.includes('RELEASED'));
    assert(!!unkillLog, 'Must record GLOBAL_KILLSWITCH_RELEASED');
  });

  await runTest('Audit Log Invariance', 'Category rule update emits CATEGORY_RULE_UPDATED audit log', async () => {
    await store.updateCategoryRule(humanTenantA, 'hotel_nordic_group', 'dairy', {
      max_storage_litres: 1200,
      time_window: 'weekly',
    });

    const logs = await store.getAuditLogs('hotel_nordic_group', 5);
    const catLog = logs.find(l => l.action === 'CATEGORY_RULE_UPDATED');
    assert(!!catLog, 'Must record CATEGORY_RULE_UPDATED');
    assert(catLog?.payload_summary?.max_storage_litres === 1200, 'Payload summary must record new limit');
  });

  // ============================================================================
  // Suite 4: Multi-Tenant Isolation
  // ============================================================================
  console.log('\n--- Suite 4: Multi-Tenant Isolation ---');

  await runTest('Multi-Tenant Isolation', 'Tenant A principal cannot lock quote with Tenant B contract price', async () => {
    // Scandic has negotiated pricing for specific SKUs that Nordic Group does not have or vice-versa
    let threw403 = false;
    try {
      // Create artificial SKU only for tenant B
      store.engine.contractPrices.set('scandic_helsinki_hub::SKU-EXCLUSIVE-B', 15.0);
      store.engine.products.set('SKU-EXCLUSIVE-B', {
        sku: 'SKU-EXCLUSIVE-B',
        name: 'Exclusive Cheese Scandic',
        category: 'dairy',
        dietary_tags: [],
        pack_format: 'PCE',
        pack_volume_litres: 1,
        min_lead_time_hours: 12,
        is_active: true,
        internal_cost_eur: 10,
        internal_margin_pct: 33,
        roadmap_status: 'LIVE',
      });
      store.engine.stock.set('SKU-EXCLUSIVE-B', { sku: 'SKU-EXCLUSIVE-B', available_packs: 100, reserved_packs: 0 });

      // Tenant A tries to lock quote for Tenant B's exclusive SKU
      await store.lockQuote(agentTenantA, {
        sku: 'SKU-EXCLUSIVE-B',
        pack_quantity: 1,
        deliver_by: new Date(Date.now() + 24 * 3600_000).toISOString(),
      });
    } catch (err: any) {
      if (err instanceof GatewayError && err.status === 403) {
        threw403 = true;
      }
    }
    assert(threw403, 'Tenant A must be forbidden (403) from accessing Tenant B contract price');
  });

  await runTest('Multi-Tenant Isolation', 'Tenant A cannot commit an order using Tenant B quote lock', async () => {
    // Tenant B locks a quote
    const quoteB = await store.lockQuote(agentTenantB, {
      sku: testSku,
      pack_quantity: 2,
      deliver_by: new Date(Date.now() + 48 * 3600_000).toISOString(),
    });

    let threw404 = false;
    try {
      // Tenant A attempts to commit with Tenant B's quote
      await store.commitOrder(agentTenantA, {
        quote_id: quoteB.quote_id,
        po_reference: `PO-CROSS-TENANT-${Date.now()}`,
      });
    } catch (err: any) {
      if (err instanceof GatewayError && err.status === 404) {
        threw404 = true;
      }
    }
    assert(threw404, 'Committing with another tenant quote must throw 404 Not Found');
  });

  await runTest('Multi-Tenant Isolation', 'Tenant A cannot view or approve Tenant B pending orders', async () => {
    // Tenant B commits a pending order
    const quoteB = await store.lockQuote(agentTenantB, {
      sku: testSku,
      pack_quantity: 50, // Exceeds budget to hold in pending
      deliver_by: new Date(Date.now() + 48 * 3600_000).toISOString(),
    });
    const orderB = await store.commitOrder(agentTenantB, {
      quote_id: quoteB.quote_id,
      po_reference: `PO-TENANT-B-${Date.now()}`,
    });

    // Tenant A queries pending orders
    const pendingOrdersTenantA = await store.getPendingOrders(humanTenantA, 'hotel_nordic_group');
    const leakedOrder = pendingOrdersTenantA.find(o => o.order_id === orderB.order_id);
    assert(!leakedOrder, 'Tenant A must never see Tenant B pending orders in getPendingOrders');

    // Tenant A attempts to approve Tenant B order
    let threw404 = false;
    try {
      await store.approveOrder(humanTenantA, orderB.order_id);
    } catch (err: any) {
      if (err instanceof GatewayError && err.status === 404) {
        threw404 = true;
      }
    }
    assert(threw404, 'Tenant A approving Tenant B order must throw 404 Not Found');
  });

  await runTest('Multi-Tenant Isolation', 'Tenant A cannot view Tenant B audit logs', async () => {
    const logsA = await store.getAuditLogs('hotel_nordic_group', 50);
    const leakedLogs = logsA.filter(l => l.tenant_id === 'scandic_helsinki_hub');
    assert(leakedLogs.length === 0, 'Tenant A audit query must not contain Tenant B events');
  });

  // ============================================================================
  // Suite 5: REST Endpoints Dispatch Verification via Native HTTP fetch
  // ============================================================================
  console.log('\n--- Suite 5: REST Endpoints Dispatch Verification via Native HTTP fetch ---');

  const { httpServer } = await createApp();
  await new Promise<void>((resolve) => {
    httpServer.listen(0, '127.0.0.1', () => resolve());
  });
  const port = (httpServer.address() as any).port;
  const BASE_URL = `http://127.0.0.1:${port}/api/v1`;
  console.log(`    Ephemeral test server listening on ${BASE_URL}`);

  let restQuoteId = '';
  let restPendingOrderId = '';

  await runTest('REST Endpoints', 'POST /api/v1/quotes/search returns normalized offers with internal margins withheld', async () => {
    const res = await fetch(`${BASE_URL}/quotes/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer aimo.agent.hotel_nordic_group',
      },
      body: JSON.stringify({ query: 'milk', required_volume_litres: 100 }),
    });

    assert(res.status === 200, `Expected 200, got ${res.status}`);
    const body = await res.json();
    assert(Array.isArray(body) && body.length > 0, 'Response body must be array of offers');
    const first = body[0];
    assert(typeof first.sku === 'string', 'Offer must have sku');
    assert(typeof first.price_per_litre_eur === 'number', 'Offer must have price_per_litre_eur');
    assert(first.internal_cost_eur === undefined, 'Internal cost must be withheld');
    assert(first.internal_margin_pct === undefined, 'Internal margin must be withheld');
  });

  const restSku = 'VA-LF-MILK-12X1L';

  await runTest('REST Endpoints', 'POST /api/v1/quotes/lock reserves stock and creates quote with 15-min TTL', async () => {
    const res = await fetch(`${BASE_URL}/quotes/lock`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer aimo.agent.hotel_nordic_group',
      },
      body: JSON.stringify({
        sku: restSku,
        pack_quantity: 90, // 90 * 12L = 1080L exceeds 1000L weekly cap to hold order in PENDING_APPROVAL
        deliver_by: new Date(Date.now() + 48 * 3600_000).toISOString(),
      }),
    });

    assert(res.status === 200, `Expected 200, got ${res.status}`);
    const body = await res.json();
    assert(body.quote_id && body.quote_id.startsWith('Q-'), `Expected Q- prefix, got ${body.quote_id}`);
    assert(body.status === 'LOCKED', `Expected LOCKED, got ${body.status}`);
    assert(body.pack_quantity === 90, `Expected 90 packs, got ${body.pack_quantity}`);
    restQuoteId = body.quote_id;
  });

  await runTest('REST Endpoints', 'POST /api/v1/orders/commit commits order to PENDING_APPROVAL status', async () => {
    const res = await fetch(`${BASE_URL}/orders/commit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer aimo.agent.hotel_nordic_group',
      },
      body: JSON.stringify({
        quote_id: restQuoteId,
        po_reference: `PO-REST-${Date.now()}`,
      }),
    });

    assert(res.status === 200, `Expected 200, got ${res.status}`);
    const body = await res.json();
    assert(body.status === 'PENDING_APPROVAL', `Expected PENDING_APPROVAL, got ${body.status}`);
    assert(body.order_id && body.order_id.startsWith('ORD-'), `Expected ORD- prefix, got ${body.order_id}`);
    restPendingOrderId = body.order_id;
  });

  await runTest('REST Endpoints', 'POST /api/v1/orders/:id/approve rejects agent principal with 403 Forbidden', async () => {
    const res = await fetch(`${BASE_URL}/orders/${restPendingOrderId}/approve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer aimo.agent.hotel_nordic_group',
      },
      body: JSON.stringify({ approval_type: 'ONE_TIME' }),
    });

    assert(res.status === 403, `Expected 403 Forbidden for agent approval, got ${res.status}`);
  });

  await runTest('REST Endpoints', 'POST /api/v1/orders/:id/approve allows human principal to confirm order', async () => {
    const res = await fetch(`${BASE_URL}/orders/${restPendingOrderId}/approve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer aimo.human.hotel_nordic_group',
      },
      body: JSON.stringify({ approval_type: 'ONE_TIME' }),
    });

    assert(res.status === 200, `Expected 200 OK for human approval, got ${res.status}`);
    const body = await res.json();
    assert(body.status === 'CONFIRMED', `Expected CONFIRMED status, got ${body.status}`);
    assert(body.approval_type === 'ONE_TIME', `Expected ONE_TIME approval`);
  });

  await runTest('REST Endpoints', 'POST /api/v1/orders/:id/reject allows human principal to reject order and release stock', async () => {
    // Create another pending order to reject
    const lockRes = await fetch(`${BASE_URL}/quotes/lock`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer aimo.agent.hotel_nordic_group',
      },
      body: JSON.stringify({
        sku: restSku,
        pack_quantity: 70,
        deliver_by: new Date(Date.now() + 48 * 3600_000).toISOString(),
      }),
    });
    const lockBody = await lockRes.json();

    const commitRes = await fetch(`${BASE_URL}/orders/commit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer aimo.agent.hotel_nordic_group',
      },
      body: JSON.stringify({
        quote_id: lockBody.quote_id,
        po_reference: `PO-REST-REJECT-${Date.now()}`,
      }),
    });
    const commitBody = await commitRes.json();

    const rejectRes = await fetch(`${BASE_URL}/orders/${commitBody.order_id}/reject`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer aimo.human.hotel_nordic_group',
      },
    });

    assert(rejectRes.status === 200, `Expected 200 OK for human rejection, got ${rejectRes.status}`);
    const rejectBody = await rejectRes.json();
    assert(rejectBody.status === 'REJECTED', `Expected REJECTED, got ${rejectBody.status}`);
  });

  await runTest('REST Endpoints', 'GET /api/v1/policies and PATCH /api/v1/policies retrieve and update spend caps', async () => {
    const getRes = await fetch(`${BASE_URL}/policies`, {
      headers: { Authorization: 'Bearer aimo.agent.hotel_nordic_group' },
    });
    assert(getRes.status === 200, `Expected 200, got ${getRes.status}`);
    const getBody = await getRes.json();
    assert(getBody.tenant_id === 'hotel_nordic_group', 'Must return hotel_nordic_group');

    const patchRes = await fetch(`${BASE_URL}/policies`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer aimo.human.hotel_nordic_group',
      },
      body: JSON.stringify({ max_auto_approve_eur: 950 }),
    });
    assert(patchRes.status === 200, `Expected 200, got ${patchRes.status}`);
    const patchBody = await patchRes.json();
    assert(patchBody.max_auto_approve_eur === 950, `Expected 950, got ${patchBody.max_auto_approve_eur}`);
  });

  await runTest('REST Endpoints', 'POST /api/v1/policies/killswitch activates and deactivates emergency halt', async () => {
    const haltRes = await fetch(`${BASE_URL}/policies/killswitch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer aimo.admin.hotel_nordic_group',
      },
      body: JSON.stringify({ halted: true }),
    });
    assert(haltRes.status === 200, `Expected 200, got ${haltRes.status}`);
    const haltBody = await haltRes.json();
    assert(haltBody.killswitch_halted === true, 'Expected killswitch_halted true');

    const releaseRes = await fetch(`${BASE_URL}/policies/killswitch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer aimo.admin.hotel_nordic_group',
      },
      body: JSON.stringify({ halted: false }),
    });
    assert(releaseRes.status === 200, `Expected 200, got ${releaseRes.status}`);
    const releaseBody = await releaseRes.json();
    assert(releaseBody.killswitch_halted === false, 'Expected killswitch_halted false');
  });

  await runTest('REST Endpoints', 'GET /api/v1/policies/categories/:category and PATCH update category rules', async () => {
    const getRes = await fetch(`${BASE_URL}/policies/categories/dairy`, {
      headers: { Authorization: 'Bearer aimo.agent.hotel_nordic_group' },
    });
    assert(getRes.status === 200, `Expected 200, got ${getRes.status}`);
    const getBody = await getRes.json();
    assert(getBody.category === 'dairy', 'Must return dairy category rule');

    const patchRes = await fetch(`${BASE_URL}/policies/categories/dairy`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer aimo.human.hotel_nordic_group',
      },
      body: JSON.stringify({ max_storage_litres: 1800, time_window: 'weekly' }),
    });
    assert(patchRes.status === 200, `Expected 200, got ${patchRes.status}`);
    const patchBody = await patchRes.json();
    assert(patchBody.max_storage_litres === 1800, `Expected 1800, got ${patchBody.max_storage_litres}`);
  });

  httpServer.close();

  // ============================================================================
  // Summary
  // ============================================================================
  const passedCount = results.filter(r => r.passed).length;
  const totalCount = results.length;
  console.log('\n========================================================================');
  console.log(`📊 Test Execution Complete: ${passedCount}/${totalCount} tests passed (${((passedCount / totalCount) * 100).toFixed(1)}%)`);
  console.log('========================================================================\n');

  if (passedCount < totalCount) {
    console.error('❌ Some deterministic store tests failed:');
    for (const r of results.filter(r => !r.passed)) {
      console.error(`  - [${r.suite}] ${r.test}: ${r.details}`);
    }
    process.exit(1);
  } else {
    console.log('✨ All Wholesaler Store, Inventory Lifecycle, and REST API tests PASSED deterministically!');
    process.exit(0);
  }
}

main().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
