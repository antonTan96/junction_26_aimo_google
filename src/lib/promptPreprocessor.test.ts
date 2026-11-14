import test from 'node:test';
import assert from 'node:assert/strict';
import {
  preprocessBuyerPromptSync,
  preprocessBuyerPrompt,
  deduceRecipeFromOntology,
  parseExplicitMaterialList,
  CULINARY_RECIPE_DATABASE,
} from './promptPreprocessor.ts';
import { ValioAimoRAGService } from './valioAimoRAG.ts';
import { AimoGateStore, DEFAULT_TENANT_ID } from './aimogate.ts';
import type { TenantPolicy } from '../types/aimogate.ts';

test('Prompt Preprocessor: Multi-material decomposition splits joined items with metric quantities', () => {
  const prompt = 'We need 50 liters of organic whole milk and 10kg butter for the bakery';
  const result = preprocessBuyerPromptSync(prompt);

  assert.equal(result.request_type, 'multi_item');
  assert.equal(result.items.length, 2, 'Should decompose into exactly 2 line items');

  const item1 = result.items[0];
  assert.equal(item1.quantity, 50);
  assert.equal(item1.unit, 'L');
  assert.ok(item1.search_query.toLowerCase().includes('milk') || item1.ingredient_name.toLowerCase().includes('milk'));
  assert.ok(item1.dietary_tags.includes('organic'), 'Should preserve organic dietary tag');

  const item2 = result.items[1];
  assert.equal(item2.quantity, 10);
  assert.equal(item2.unit, 'kg');
  assert.ok(item2.search_query.toLowerCase().includes('butter') || item2.ingredient_name.toLowerCase().includes('butter'));
});

test('Prompt Preprocessor: Cookie recipe deduction scales yield to 1,000 cookies and substitutes gluten-free flour', () => {
  const prompt = 'I need ingredients for 1,000 gluten-free licorice cookies for a wedding event next Thursday.';
  const result = preprocessBuyerPromptSync(prompt);

  assert.equal(result.request_type, 'recipe');
  assert.ok(result.recipe);
  assert.equal(result.recipe.name, 'Cookies & Biscuits');
  assert.equal(result.recipe.servings_or_yield, 1000);
  assert.equal(result.recipe.yield_unit, 'cookies');
  assert.ok(result.dietary_tags.includes('gluten-free'), 'Recipe should carry gluten-free tag');

  // Should have deduced 5 essential raw materials: GF flour mix, butter, sugar, baking powder, licorice
  assert.equal(result.items.length, 5);

  const flourItem = result.items.find((i) => i.search_query.includes('jauhoseos') || i.ingredient_name.includes('Gluten-Free'));
  assert.ok(flourItem, 'Should find gluten-free flour substitute');
  assert.equal(flourItem.quantity, 25.0, '25kg flour mix for 1,000 cookies');
  assert.equal(flourItem.unit, 'kg');
  assert.ok(flourItem.dietary_tags.includes('gluten-free'));

  const butterItem = result.items.find((i) => i.search_query.includes('voi'));
  assert.ok(butterItem, 'Should find cooking butter');
  assert.equal(butterItem.quantity, 15.0, '15kg butter for 1,000 cookies');
  assert.equal(butterItem.unit, 'kg');

  const sugarItem = result.items.find((i) => i.search_query.includes('sokeri'));
  assert.ok(sugarItem, 'Should find granulated sugar');
  assert.equal(sugarItem.quantity, 12.0, '12kg sugar for 1,000 cookies');

  const licoriceItem = result.items.find((i) => i.search_query.includes('lakritsi'));
  assert.ok(licoriceItem, 'Should find licorice inclusion');
  assert.equal(licoriceItem.quantity, 10.0, '10kg licorice for 1,000 cookies');
});

test('Prompt Preprocessor: Salmon soup (lohikeitto) recipe deduction scales to 50 portions', () => {
  const prompt = 'Salmon soup for 50 people by Friday morning.';
  const result = preprocessBuyerPromptSync(prompt);

  assert.equal(result.request_type, 'recipe');
  assert.ok(result.recipe);
  assert.equal(result.recipe.name, 'Traditional Finnish Salmon Soup (Lohikeitto)');
  assert.equal(result.recipe.servings_or_yield, 50);

  // Scale is 50 / 10 = 5x
  const salmon = result.items.find((i) => i.search_query.includes('lohi'));
  assert.ok(salmon);
  assert.equal(salmon.quantity, 7.5, '1.5kg * 5 = 7.5kg salmon fillet');

  const potatoes = result.items.find((i) => i.search_query.includes('peruna'));
  assert.ok(potatoes);
  assert.equal(potatoes.quantity, 7.5, '1.5kg * 5 = 7.5kg potatoes');

  const cream = result.items.find((i) => i.search_query.includes('kuohukerma'));
  assert.ok(cream);
  assert.equal(cream.quantity, 3.0, '0.6L * 5 = 3.0L heavy cream');
});

test('Prompt Preprocessor: Cinnamon buns (korvapuusti) deduction scales to 200 buns', () => {
  const prompt = 'Bake 200 cinnamon buns (korvapuusti) for the weekend cafeteria';
  const result = preprocessBuyerPromptSync(prompt);

  assert.equal(result.request_type, 'recipe');
  assert.ok(result.recipe);
  assert.equal(result.recipe.name, 'Finnish Cinnamon Buns (Korvapuusti)');
  assert.equal(result.recipe.servings_or_yield, 200);

  // Scale is 200 / 10 = 20x
  const flour = result.items.find((i) => i.search_query.includes('vehnäjauho'));
  assert.ok(flour);
  assert.equal(flour.quantity, 9.0, '0.45kg * 20 = 9.0kg wheat flour');

  const milk = result.items.find((i) => i.search_query.includes('täysmaito'));
  assert.ok(milk);
  assert.equal(milk.quantity, 6.0, '0.3L * 20 = 6.0L whole milk');

  const yeast = result.items.find((i) => i.search_query.includes('hiiva'));
  assert.ok(yeast);
  assert.equal(yeast.quantity, 0.6, '0.03kg * 20 = 0.6kg yeast');
});

test('Prompt Preprocessor: Explicit custom recipe string is parsed into structured line items', () => {
  const prompt = 'Recipe for strawberry shortcake: 500g strawberries, 200g sugar, 400g flour';
  const result = preprocessBuyerPromptSync(prompt);

  assert.equal(result.request_type, 'recipe');
  assert.ok(result.recipe);
  assert.ok(result.recipe.name.toLowerCase().includes('strawberry shortcake'));
  assert.equal(result.items.length, 3);

  const sugar = result.items.find((i) => i.ingredient_name.includes('sugar'));
  assert.ok(sugar);
  assert.equal(sugar.quantity, 0.2, '200g normalized to 0.2kg');
  assert.equal(sugar.unit, 'kg');
});

test('Prompt Preprocessor: Single product procurement remains completely backward compatible', () => {
  const prompt = 'Order 1,000 litres of lactose-free milk by Monday.';
  const result = preprocessBuyerPromptSync(prompt);

  assert.equal(result.request_type, 'single_item');
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].quantity, 1000);
  assert.equal(result.items[0].unit, 'L');
  assert.ok(result.items[0].dietary_tags.includes('lactose-free'));
});

test('ValioAimoRAGService: RAG pipeline retrieves and quotes full recipe BOM with audit traces', async () => {
  const ragService = ValioAimoRAGService.getInstance();
  const mockPolicy: TenantPolicy = {
    tenant_id: DEFAULT_TENANT_ID,
    tenant_name: 'Hotel Grand Nordic',
    max_auto_approve_eur: 5000,
    max_auto_approve_litres: 5000,
    allowed_categories: ['dairy', 'bakery', 'produce', 'meat', 'beverages', 'general'],
    anomaly_sensitivity_pct: 10,
    auto_dispute_enabled: true,
  };

  const prompt = 'I need ingredients for 1,000 gluten-free licorice cookies for a wedding event next Thursday.';
  const ragResult = await ragService.executeRAGPipeline({
    prompt,
    policy: mockPolicy,
  });

  assert.equal(ragResult.agentResponse.success, true);
  assert.ok(ragResult.agentResponse.preprocessed_prompt);
  assert.equal(ragResult.agentResponse.preprocessed_prompt.request_type, 'recipe');

  const order = ragResult.agentResponse.order;
  assert.ok(order);
  assert.equal(order.recipe_name, 'Cookies & Biscuits');
  assert.ok(order.items && order.items.length >= 4, 'Order should contain composite line items for the recipe');
  assert.ok(order.total_eur > 0, 'Composite order must have non-zero cost');
  assert.equal(ragResult.policyResult.passes, true);
  assert.equal(ragResult.agentResponse.final_status, 'CONFIRMED');

  // Verify that gluten-free flour was selected and not pizza base
  const flourLine = order.items.find((it) => it.product_name.toLowerCase().includes('flour') || it.product_name.toLowerCase().includes('jauho'));
  assert.ok(flourLine, 'Should have flour line item');
  assert.ok(!flourLine.product_name.toLowerCase().includes('pizza'), 'Flour must not be pizza base');
});

test('AimoGateStore: runAgentWorkflow handles multi-material and recipe requests deterministically', () => {
  const store = new AimoGateStore();
  const prompt = 'We need 50 liters of organic whole milk and 10kg butter for the bakery';

  const res = store.runAgentWorkflow({
    prompt,
    mode: 'deterministic',
  });

  assert.equal(res.success, true);
  assert.ok(res.preprocessed_prompt);
  assert.equal(res.preprocessed_prompt.request_type, 'multi_item');
  assert.ok(res.order);
  assert.ok(res.order.items && res.order.items.length === 2, 'Should create 2 line items in order');
  assert.equal(res.order.status, 'CONFIRMED');
  assert.ok(res.order.total_eur > 0);
});

test('Prompt Preprocessor: Reverse recipe matching recognizes dish from pure ingredients and estimates yield', () => {
  const prompt = '25kg wheat flour, 15kg butter, 12kg sugar, 2kg baking powder';
  const result = preprocessBuyerPromptSync(prompt);

  assert.equal(result.request_type, 'recipe');
  assert.ok(result.recipe);
  assert.equal(result.recipe.name, 'Cookies & Biscuits');
  assert.equal(result.recipe.is_recognized_from_ingredients, true);
  assert.ok((result.recipe.servings_or_yield || 0) >= 50);
  assert.ok(result.items.length >= 4);
});

test('Prompt Preprocessor: Sanitizes operational directives and extracts items cleanly without phantom products', () => {
  const prompt =
    '"Order 150 litres of Valio lactose-free semi-skimmed milk, unsalted butter for Tuesday morning delivery. Check fixed contract prices (15 kg), availability, lock the quote, commit the order if it complies with our autonomous purchasing rules."';
  const result = preprocessBuyerPromptSync(prompt);

  assert.equal(result.items.length, 2, 'Should decompose into exactly 2 physical products');
  assert.equal(result.items[0].ingredient_name, 'Valio lactose-free semi-skimmed milk');
  assert.equal(result.items[0].quantity, 150);
  assert.equal(result.items[0].unit, 'L');
  assert.equal(result.items[1].ingredient_name, 'unsalted butter');
  assert.equal(result.items[1].quantity, 15);
  assert.equal(result.items[1].unit, 'kg');
});

test('ValioAimoRAGService: Informational inquiries return live data without phantom order or quote lock', async () => {
  const rag = ValioAimoRAGService.getInstance();

  const policyRes = await rag.executeRAGPipeline({ prompt: 'What is our spend limit for dairy?' });
  assert.equal(policyRes.agentResponse.final_status, 'INFORMATIONAL');
  assert.equal(policyRes.agentResponse.order, null);
  assert.ok(policyRes.agentResponse.summary_message.includes('Policy & Governance Summary'));

  const stockRes = await rag.executeRAGPipeline({ prompt: 'Check stock of oat milk' });
  assert.equal(stockRes.agentResponse.final_status, 'INFORMATIONAL');
  assert.equal(stockRes.agentResponse.order, null);
  assert.ok(stockRes.agentResponse.summary_message.includes('Live Stock & Availability'));

  const priceRes = await rag.executeRAGPipeline({ prompt: 'What is the price of butter?' });
  assert.equal(priceRes.agentResponse.final_status, 'INFORMATIONAL');
  assert.equal(priceRes.agentResponse.order, null);
  assert.ok(priceRes.agentResponse.summary_message.includes('Live Contract Pricing'));
});
