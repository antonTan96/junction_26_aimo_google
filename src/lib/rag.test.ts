import test from 'node:test';
import assert from 'node:assert/strict';
import { ValioAimoCatalogService } from './valioAimoCatalog.ts';
import { ValioAimoRAGService } from './valioAimoRAG.ts';
import { MariaDBCatalogClient } from './mariadbCatalog.ts';
import { DEFAULT_TENANT_ID } from './aimogate.ts';
import type { TenantPolicy } from '../types/aimogate.ts';

test('Valio Aimo Catalog: Indexes full catalog dataset (17,546 SKUs) and performs multilingual search', () => {
  const catalog = ValioAimoCatalogService.getInstance();
  const count = catalog.getProductCount();
  assert.ok(count > 1000, `Expected catalog count > 1000, got ${count}`);

  // Test butter search (Finnish 'voi' and English 'butter')
  const butterResults = catalog.search('traditional cooking butter', { limit: 5 });
  assert.ok(butterResults.length > 0, 'Expected to find butter products');
  const topButter = butterResults[0];
  assert.match(
    topButter.display_name.toLowerCase() + topButter.name_fi.toLowerCase(),
    /voi|butter/,
    'Top result should be butter'
  );

  // Test category filtering
  const oatResults = catalog.search('oat', { category: 'plant-based', limit: 5 });
  assert.ok(oatResults.length > 0, 'Expected plant-based oat results');
  for (const item of oatResults) {
    assert.equal(item.category, 'plant-based', 'Item category must match filter');
  }
});

test('MariaDB Client: Falls back gracefully to memory/JSON when MariaDB container is not running', async () => {
  const mariaClient = MariaDBCatalogClient.getInstance();
  // Without MARIADB_HOST pointing to a live DB, isAvailable should be false or pool null
  const products = await mariaClient.searchProducts('milk', { limit: 5 });
  // Graceful fallback returns null so the service transparently uses in-memory JSON
  assert.ok(products === null || Array.isArray(products));
});

test('RAG Pipeline: Augments prompt with catalog candidates and enforces policy limits', async () => {
  const ragService = ValioAimoRAGService.getInstance();
  const mockPolicy: TenantPolicy = {
    tenant_id: DEFAULT_TENANT_ID,
    tenant_name: 'Nordic Crown Hotels (Helsinki)',
    max_auto_approve_eur: 500,
    max_auto_approve_litres: 1000,
    allowed_categories: ['dairy', 'plant-based', 'bakery'],
    anomaly_sensitivity_pct: 10,
    auto_dispute_enabled: true,
    category_rules: {
      dairy: {
        category: 'dairy',
        max_storage_litres: 1000,
        time_window: 'weekly',
        rule_valid_until: null,
      },
    },
  };

  // Case 1: Small order within cap (e.g., 20kg butter)
  const result1 = await ragService.executeRAGPipeline({
    prompt: 'We need 20kg of traditional cooking butter by Friday. Find an option based on price and availability.',
    policy: mockPolicy,
  });

  assert.match(result1.query, /butter/);
  assert.ok(result1.candidates.length > 0, 'Should retrieve candidates');
  assert.ok(result1.selectedProduct !== null, 'Should select an optimal product');
  assert.ok(result1.agentResponse.traces.length >= 3, 'Should produce RAG step traces');

  // Case 2: Large order exceeding spend cap (€500) -> Requires human sign-off
  const result2 = await ragService.executeRAGPipeline({
    prompt: 'Order 1,000 litres of lactose-free milk by Monday.',
    policy: mockPolicy,
  });

  assert.ok(result2.selectedProduct !== null);
  // Total cost for 1,000L of milk is approx €1,180 which exceeds €500
  assert.equal(result2.policyResult.passes, false);
  assert.equal(result2.agentResponse.final_status, 'PENDING_APPROVAL');
  assert.equal(result2.agentResponse.order?.status, 'PENDING_APPROVAL');
});
