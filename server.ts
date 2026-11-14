import 'dotenv/config';
import http from 'node:http';
import express, { type Request, type Response, type NextFunction } from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  DEFAULT_TENANT_ID,
  GatewayError,
  SYSTEM_CATEGORIES,
} from './src/lib/aimogate.ts';
import { ValioAimoCatalogService } from './src/lib/valioAimoCatalog.ts';
import { ValioAimoRAGService } from './src/lib/valioAimoRAG.ts';
import { MariaDBCatalogClient } from './src/lib/mariadbCatalog.ts';
import { PersistentAimoGateStore } from './src/lib/firestoreStore.ts';
import { createAimoGateMcpServer } from './src/lib/mcpServer.ts';
import {
  preprocessBuyerPrompt,
  deduceRecipeFromOntology,
  CULINARY_RECIPE_DATABASE,
} from './src/lib/promptPreprocessor.ts';
import type { Principal, PrincipalType } from './src/types/aimogate.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const store = new PersistentAimoGateStore();

function resolvePrincipal(req: Request): Principal {
  const auth = req.headers.authorization;
  const queryTenant =
    typeof req.query.tenant_id === 'string' && req.query.tenant_id.trim()
      ? req.query.tenant_id.trim()
      : undefined;

  if (!auth || !auth.startsWith('Bearer ')) {
    return store.engine.getPresetPrincipal('agent', queryTenant || DEFAULT_TENANT_ID);
  }

  const token = auth.slice('Bearer '.length).trim();
  const parts = token.split('.');
  if (parts.length >= 3 && parts[0] === 'aimo') {
    const role = parts[1] as PrincipalType;
    const tokenTenant = parts.slice(2).join('.') || DEFAULT_TENANT_ID;
    if (role === 'admin') {
      return store.engine.getPresetPrincipal('admin', queryTenant || tokenTenant);
    }
    if (queryTenant && queryTenant !== tokenTenant) {
      throw new GatewayError(403, `Cross-tenant access forbidden. Token belongs to '${tokenTenant}'.`);
    }
    if (role === 'agent' || role === 'human') {
      return store.engine.getPresetPrincipal(role, tokenTenant);
    }
  }

  throw new GatewayError(401, 'Invalid or unrecognized bearer token.');
}

function requirePrincipal(
  principal: Principal,
  allowedTypes: PrincipalType[],
  requiredScopes: string[] = []
): void {
  store.engine.requirePrincipal(principal, allowedTypes, requiredScopes);
}

const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

export async function createApp() {
  const app = express();
  const httpServer = http.createServer(app);
  app.use(express.json());

  const api = express.Router();


  // Health & Gateway Root
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', persistence: store.getBackendMode(), mcp_endpoint: '/mcp' });
  });

  app.get('/api', (_req, res) => {
    res.json({
      gateway: 'AimoGate',
      description: 'Zero-Trust B2B Trade & Governance Gateway for Valio Aimo',
      status: 'operational',
      version: '1.0.0',
      mcp_enabled: true,
      mcp_endpoint: '/mcp',
      persistence: store.getBackendMode(),
    });
  });

  // --- Model Context Protocol (MCP) Streamable HTTP Endpoint ---
  app.post(
    '/mcp',
    asyncHandler(async (req, res) => {
      const principal = resolvePrincipal(req);
      const mcpServer = createAimoGateMcpServer(store, principal);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });

      res.on('close', () => {
        void transport.close();
        void mcpServer.close();
      });

      await mcpServer.connect(transport);
      await transport.handleRequest(req, res, req.body);
    })
  );

  app.get('/mcp', (_req, res) => {
    res.json({
      name: 'aimogate-valio-aimo',
      version: '1.0.0',
      transport: 'streamable-http',
      endpoint: '/mcp',
      auth: 'Optional Authorization: Bearer aimo.agent.<tenant_id> (defaults to agent principal)',
      tools: ['search_offers', 'lock_quote', 'commit_order', 'get_tenant_policy'],
    });
  });

  app.delete('/mcp', (_req, res) => {
    res.status(405).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed in stateless MCP mode.' },
      id: null,
    });
  });

  // --- Tools (Agent REST Gateway) & Route Aliases ---
  const searchOffersHandler = asyncHandler(async (req, res) => {
    const principal = resolvePrincipal(req);
    const offers = await store.searchOffers(principal, req.body || {});
    res.json(offers);
  });
  api.post('/tools/search_offers', searchOffersHandler);
  api.post('/quotes/search', searchOffersHandler);

  const lockQuoteHandler = asyncHandler(async (req, res) => {
    const principal = resolvePrincipal(req);
    const quote = await store.lockQuote(principal, req.body);
    res.json(quote);
  });
  api.post('/tools/lock_quote', lockQuoteHandler);
  api.post('/quotes/lock', lockQuoteHandler);

  const commitOrderHandler = asyncHandler(async (req, res) => {
    const principal = resolvePrincipal(req);
    const order = await store.commitOrder(principal, req.body);
    res.json(order);
  });
  api.post('/tools/commit_order', commitOrderHandler);
  api.post('/orders/commit', commitOrderHandler);

  // --- Orders & HITL Approvals ---
  api.get(
    '/orders',
    asyncHandler(async (req, res) => {
      const principal = resolvePrincipal(req);
      const tenantId = typeof req.query.tenant_id === 'string' ? req.query.tenant_id : principal.tenant_id;
      const statusFilter =
        typeof req.query.status_filter === 'string' ? req.query.status_filter.toUpperCase() : undefined;
      res.json(await store.getOrders(tenantId, statusFilter));
    })
  );

  api.get(
    '/orders/pending',
    asyncHandler(async (req, res) => {
      const principal = resolvePrincipal(req);
      const tenantId = typeof req.query.tenant_id === 'string' ? req.query.tenant_id : principal.tenant_id;
      res.json(await store.getPendingOrders(principal, tenantId));
    })
  );

  api.get(
    '/orders/recurrent-grants',
    asyncHandler(async (req, res) => {
      const principal = resolvePrincipal(req);
      const tenantId = typeof req.query.tenant_id === 'string' ? req.query.tenant_id : principal.tenant_id;
      res.json(await store.getGrants(tenantId));
    })
  );

  api.get(
    '/orders/audit/logs',
    asyncHandler(async (req, res) => {
      const principal = resolvePrincipal(req);
      const limit = Number(req.query.limit || 50);
      res.json(await store.getAuditLogs(principal.tenant_id, limit));
    })
  );

  api.post(
    '/orders/:orderId/approve',
    asyncHandler(async (req, res) => {
      const principal = resolvePrincipal(req);
      const order = await store.approveOrder(principal, req.params.orderId, req.body || {});
      res.json(order);
    })
  );

  api.post(
    '/orders/:orderId/reject',
    asyncHandler(async (req, res) => {
      const principal = resolvePrincipal(req);
      const order = await store.rejectOrder(principal, req.params.orderId);
      res.json(order);
    })
  );

  // --- Inventory Shortage & Substitution Approval Endpoints ---
  api.post(
    '/orders/:orderId/substitution/accept',
    asyncHandler(async (req, res) => {
      const principal = resolvePrincipal(req);
      const order = await store.acceptSubstitution(principal, req.params.orderId, req.body || {});
      res.json(order);
    })
  );

  api.post(
    '/orders/:orderId/substitution/reject',
    asyncHandler(async (req, res) => {
      const principal = resolvePrincipal(req);
      const order = await store.rejectSubstitution(principal, req.params.orderId, req.body || {});
      res.json(order);
    })
  );

  // --- Policies & Guardrails ---
  api.get(
    '/policies',
    asyncHandler(async (req, res) => {
      const principal = resolvePrincipal(req);
      const targetTenant = typeof req.query.tenant_id === 'string' ? req.query.tenant_id : principal.tenant_id;
      res.json(await store.getPolicy(targetTenant));
    })
  );

  api.get(
    '/policies/guardrails',
    asyncHandler(async (req, res) => {
      const principal = resolvePrincipal(req);
      const targetTenant = typeof req.query.tenant_id === 'string' ? req.query.tenant_id : principal.tenant_id;
      res.json(await store.getCustomerGuardrails(targetTenant));
    })
  );

  api.get(
    '/policies/categories',
    asyncHandler(async (req, res) => {
      const principal = resolvePrincipal(req);
      const targetTenant = typeof req.query.tenant_id === 'string' ? req.query.tenant_id : principal.tenant_id;
      res.json(await store.getCategoryRules(targetTenant));
    })
  );

  api.get(
    '/policies/categories/:category',
    asyncHandler(async (req, res) => {
      const principal = resolvePrincipal(req);
      const targetTenant = typeof req.query.tenant_id === 'string' ? req.query.tenant_id : principal.tenant_id;
      res.json(await store.getCategoryRule(targetTenant, req.params.category));
    })
  );

  api.patch(
    '/policies',
    asyncHandler(async (req, res) => {
      const principal = resolvePrincipal(req);
      const targetTenant = typeof req.query.tenant_id === 'string' ? req.query.tenant_id : principal.tenant_id;
      const updated = await store.updatePolicy(principal, targetTenant, req.body || {});
      res.json(updated);
    })
  );

  const updateCategoryHandler = asyncHandler(async (req, res) => {
    const principal = resolvePrincipal(req);
    const targetTenant = typeof req.query.tenant_id === 'string' ? req.query.tenant_id : principal.tenant_id;
    const updated = await store.updateCategoryRule(principal, targetTenant, req.params.category, req.body || {});
    res.json(updated);
  });

  api.patch('/policies/categories/:category', updateCategoryHandler);
  api.put('/policies/categories/:category', updateCategoryHandler);

  // --- Substitution Rules Management ---
  api.get(
    '/policies/substitution-rules',
    asyncHandler(async (req, res) => {
      const principal = resolvePrincipal(req);
      const targetTenant = typeof req.query.tenant_id === 'string' ? req.query.tenant_id : principal.tenant_id;
      res.json(await store.getSubstitutionRules(targetTenant));
    })
  );

  api.post(
    '/policies/substitution-rules',
    asyncHandler(async (req, res) => {
      const principal = resolvePrincipal(req);
      const targetTenant = typeof req.query.tenant_id === 'string' ? req.query.tenant_id : principal.tenant_id;
      const rule = await store.setSubstitutionRule(principal, targetTenant, req.body || {});
      res.json(rule);
    })
  );

  api.delete(
    '/policies/substitution-rules/:sku',
    asyncHandler(async (req, res) => {
      const principal = resolvePrincipal(req);
      const targetTenant = typeof req.query.tenant_id === 'string' ? req.query.tenant_id : principal.tenant_id;
      const ok = await store.deleteSubstitutionRule(principal, targetTenant, req.params.sku);
      res.json({ success: ok, deleted_sku: req.params.sku });
    })
  );

  // --- Autonomous Buyer Agent & Scheduled Prompts ---
  api.post(
    '/agent/run',
    asyncHandler(async (req, res) => {
      const mode = req.body?.mode;
      if (mode === 'deterministic') {
        res.json(await store.runAgentWorkflow(req.body || {}));
        return;
      }

      // Default to Google Gemini 2.5 Flash / Pro RAG pipeline (with fallback to Nemotron & Deterministic)
      const tenantId = req.body?.tenant_id || DEFAULT_TENANT_ID;
      const policy = await store.getPolicy(tenantId);
      const orders = await store.getOrders(tenantId);
      const ragService = ValioAimoRAGService.getInstance();
      const result = await ragService.executeRAGPipeline({
        prompt: req.body?.prompt || 'Order dairy supplies',
        policy,
        existingOrders: orders,
        customer: req.body?.customer || '123',
      });

      if (result.agentResponse.order && result.quoteLocked) {
        store.engine.quoteLocks.set(result.quoteLocked.quote_id, result.quoteLocked);
        store.engine.orders.set(result.agentResponse.order.order_id, result.agentResponse.order);

        // Deplete inventory when order is created and confirmed (BUG-05)
        const itemsToDeplete: { sku: string; packs: number }[] = [];
        if (result.agentResponse.order.items && result.agentResponse.order.items.length > 0) {
          for (const item of result.agentResponse.order.items) {
            itemsToDeplete.push({ sku: item.sku, packs: item.pack_quantity });
          }
        } else if (result.quoteLocked) {
          itemsToDeplete.push({ sku: result.quoteLocked.sku, packs: result.quoteLocked.pack_quantity });
        }

        if (result.agentResponse.order.status === 'CONFIRMED') {
          result.quoteLocked.status = 'CONSUMED';
          for (const { sku, packs } of itemsToDeplete) {
            const stockRec = store.engine.stock.get(sku);
            if (stockRec) {
              stockRec.available_packs = Math.max(0, stockRec.available_packs - packs);
            }
          }
        } else if (result.agentResponse.order.status === 'PENDING_APPROVAL') {
          for (const { sku, packs } of itemsToDeplete) {
            const stockRec = store.engine.stock.get(sku);
            if (stockRec) {
              const actualPacks = Math.min(stockRec.available_packs, packs);
              stockRec.available_packs = Math.max(0, stockRec.available_packs - actualPacks);
              stockRec.reserved_packs += actualPacks;
            }
          }
        }

        const activeModel = result.agentResponse.mode_used || 'gemini-2.5-flash';
        store.engine.addAuditLog({
          tenant_id: tenantId,
          actor_type: 'agent',
          actor_id: `buyer_agent_${tenantId}`,
          action: 'AUTONOMOUS_RAG_ORDER',
          payload_summary: {
            prompt: req.body?.prompt,
            model: activeModel,
            sku: result.selectedProduct?.product.id,
            name: result.selectedProduct?.product.display_name,
            total_eur: result.selectedProduct?.totalCostEur,
            verdict: result.policyResult.passes ? 'AUTO_APPROVED' : 'PENDING_APPROVAL',
          },
        });
        await store.persist();
      }

      res.json(result.agentResponse);
    })
  );

  api.post(
    '/agent/run-rag',
    asyncHandler(async (req, res) => {
      const tenantId = req.body?.tenant_id || DEFAULT_TENANT_ID;
      const policy = await store.getPolicy(tenantId);
      const orders = await store.getOrders(tenantId);
      const ragService = ValioAimoRAGService.getInstance();
      const result = await ragService.executeRAGPipeline({
        prompt: req.body?.prompt || 'Order dairy supplies',
        policy,
        existingOrders: orders,
        customer: req.body?.customer || '123',
      });

      if (result.agentResponse.order && result.quoteLocked) {
        store.engine.quoteLocks.set(result.quoteLocked.quote_id, result.quoteLocked);
        store.engine.orders.set(result.agentResponse.order.order_id, result.agentResponse.order);

        // Deplete inventory when order is created and confirmed (BUG-05)
        const itemsToDeplete: { sku: string; packs: number }[] = [];
        if (result.agentResponse.order.items && result.agentResponse.order.items.length > 0) {
          for (const item of result.agentResponse.order.items) {
            itemsToDeplete.push({ sku: item.sku, packs: item.pack_quantity });
          }
        } else if (result.quoteLocked) {
          itemsToDeplete.push({ sku: result.quoteLocked.sku, packs: result.quoteLocked.pack_quantity });
        }

        if (result.agentResponse.order.status === 'CONFIRMED') {
          result.quoteLocked.status = 'CONSUMED';
          for (const { sku, packs } of itemsToDeplete) {
            const stockRec = store.engine.stock.get(sku);
            if (stockRec) {
              stockRec.available_packs = Math.max(0, stockRec.available_packs - packs);
            }
          }
        } else if (result.agentResponse.order.status === 'PENDING_APPROVAL') {
          for (const { sku, packs } of itemsToDeplete) {
            const stockRec = store.engine.stock.get(sku);
            if (stockRec) {
              const actualPacks = Math.min(stockRec.available_packs, packs);
              stockRec.available_packs = Math.max(0, stockRec.available_packs - actualPacks);
              stockRec.reserved_packs += actualPacks;
            }
          }
        }

        store.engine.addAuditLog({
          tenant_id: tenantId,
          actor_type: 'agent',
          actor_id: `rag_agent_${tenantId}`,
          action: 'RAG_ORDER_PROPOSAL',
          payload_summary: {
            prompt: req.body?.prompt,
            sku: result.selectedProduct?.product.id,
            name: result.selectedProduct?.product.display_name,
            total_eur: result.selectedProduct?.totalCostEur,
            verdict: result.policyResult.passes ? 'AUTO_APPROVED' : 'PENDING_APPROVAL',
          },
        });
        await store.persist();
      }

      res.json(result);
    })
  );

  // --- Culinary Recipes & Prompt Preprocessing Engine ---
  api.post(
    '/prompt/preprocess',
    asyncHandler(async (req, res) => {
      const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt : '';
      if (!prompt.trim()) {
        throw new GatewayError(400, 'Field "prompt" is required.');
      }
      const result = await preprocessBuyerPrompt(prompt);
      res.json(result);
    })
  );

  api.get('/recipes', (_req, res) => {
    res.json({
      count: Object.keys(CULINARY_RECIPE_DATABASE).length,
      recipes: Object.entries(CULINARY_RECIPE_DATABASE).map(([key, r]) => ({
        key,
        name: r.name,
        aliases: r.aliases,
        default_yield: r.defaultYield,
        yield_unit: r.yieldUnit,
        cuisine: r.cuisine,
        description: r.description,
        ingredient_count: r.baseIngredients.length,
        base_ingredients: r.baseIngredients.map((ing) => ({
          name: ing.name,
          search_query: ing.searchQuery,
          base_qty_per_10: ing.baseQtyPer10Servings,
          unit: ing.unit,
          category: ing.categoryHint,
          role: ing.role,
        })),
      })),
    });
  });

  api.post(
    '/recipes/deduce',
    asyncHandler(async (req, res) => {
      const recipeKey = req.body?.recipe || req.body?.recipe_key || '';
      const targetYield = typeof req.body?.yield === 'number' ? req.body.yield : 10;
      const dietaryTags = Array.isArray(req.body?.dietary_tags) ? req.body.dietary_tags : [];
      const specialty = typeof req.body?.specialty === 'string' ? req.body.specialty : undefined;

      const ingredients = deduceRecipeFromOntology(recipeKey, targetYield, dietaryTags, specialty);
      if (ingredients.length === 0) {
        throw new GatewayError(404, `Recipe '${recipeKey}' not found in culinary ontology. Supported recipes: ${Object.keys(CULINARY_RECIPE_DATABASE).join(', ')}`);
      }

      res.json({
        recipe_key: recipeKey,
        target_yield: targetYield,
        dietary_tags: dietaryTags,
        specialty,
        ingredients,
      });
    })
  );

  api.get(
    '/schedules',
    asyncHandler(async (req, res) => {
      const tenantId = typeof req.query.tenant_id === 'string' ? req.query.tenant_id : undefined;
      res.json(await store.getSchedules(tenantId));
    })
  );

  api.post(
    '/schedules',
    asyncHandler(async (req, res) => {
      res.json(await store.addSchedule(req.body || {}));
    })
  );

  // --- Demo Controls & Zero-Trust Inspector ---
  api.post(
    '/demo/reset',
    asyncHandler(async (_req, res) => {
      await store.reset();
      res.json({
        status: 'success',
        message: 'Demo state reset successfully.',
        tenant_id: DEFAULT_TENANT_ID,
      });
    })
  );

  api.get(
    '/demo/tokens',
    asyncHandler(async (req, res) => {
      const tenantId = typeof req.query.tenant_id === 'string' ? req.query.tenant_id : DEFAULT_TENANT_ID;
      res.json(await store.getTokenBundle(tenantId));
    })
  );

  api.get(
    '/demo/inspect',
    asyncHandler(async (req, res) => {
      const tenantId = typeof req.query.tenant_id === 'string' ? req.query.tenant_id : DEFAULT_TENANT_ID;
      res.json(await store.inspectZeroTrustPayloads(tenantId));
    })
  );

  api.get(
    '/demo/stock',
    asyncHandler(async (_req, res) => {
      res.json(await store.getStockSummary());
    })
  );

  // --- Valio Aimo Live Catalog & RAG Discovery Routes ---
  api.get(
    '/catalog/status',
    asyncHandler(async (_req, res) => {
      const mariaDb = MariaDBCatalogClient.getInstance();
      const service = ValioAimoCatalogService.getInstance();
      const memCount = service.getProductCount();
      const mariaCount = await mariaDb.getProductCount();

      res.json({
        backend: mariaDb.isAvailable() ? 'mariadb' : 'in-memory-json',
        catalog_items: mariaCount ?? memCount,
        source_dataset: 'valio_aimo_junction26_product_data.json (17,546 SKUs)',
        rag_enabled: true,
        llm: {
          primary_model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
          provider: 'Google DeepMind (Gemini 2.5 Flash / Pro)',
          secondary_provider: 'DataCrunch B300 (NVIDIA Nemotron 3.5 Super-VL)',
          fallback: 'Deterministic Culinary Ontology & Wholesaler Unit-Economics Solver',
        },
        upstream_api: {
          base_url: 'https://junction26.valioaimo.fi',
          endpoints: ['/api/ping', '/api/price', '/api/availability'],
          live_sync_enabled: true,
        },
        mariadb: {
          connected: mariaDb.isAvailable(),
          host: process.env.MARIADB_HOST || '127.0.0.1',
          port: Number(process.env.MARIADB_PORT || 3306),
          database: process.env.MARIADB_DATABASE || 'aimogate',
        },
      });
    })
  );

  api.get(
    '/catalog/search',
    asyncHandler(async (req, res) => {
      const q = typeof req.query.q === 'string' ? req.query.q : '';
      const category = typeof req.query.category === 'string' ? req.query.category : undefined;
      const tag = typeof req.query.tag === 'string' ? [req.query.tag] : undefined;
      const limit = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : 24;

      const service = ValioAimoCatalogService.getInstance();
      const mariaDb = MariaDBCatalogClient.getInstance();

      let products = await mariaDb.searchProducts(q, { category, tags: tag, limit });
      const backendUsed = products !== null ? 'mariadb' : 'in-memory-json';
      if (!products) {
        products = service.search(q, { category, tags: tag, limit });
      }

      res.json({
        total: products.length,
        catalog_size: service.getProductCount(),
        backend: backendUsed,
        products,
      });
    })
  );

  api.get(
    '/catalog/product/:id',
    asyncHandler(async (req, res) => {
      const service = ValioAimoCatalogService.getInstance();
      const product = service.getProductById(req.params.id);
      if (!product) {
        throw new GatewayError(404, `Product '${req.params.id}' not found in Valio Aimo catalog.`);
      }

      // Query live price and stock on-demand
      const [prices, stock] = await Promise.all([
        service.fetchLivePrices([product.id]),
        service.fetchLiveAvailability([product.id]),
      ]);

      res.json({
        product,
        live_price: prices.get(product.id) || null,
        live_stock: stock.get(product.id) || null,
      });
    })
  );

  api.post(
    '/catalog/sync',
    asyncHandler(async (_req, res) => {
      const service = ValioAimoCatalogService.getInstance();
      const count = await service.pullFromUpstream();
      res.json({
        status: 'ok',
        catalog_items: count,
        source: 'https://junction26.valioaimo.fi/api/products/download',
      });
    })
  );

  // --- Wholesaler Tower Admin Routes ---
  api.get(
    '/admin/overview',
    asyncHandler(async (_req, res) => {
      res.json(await store.getNetworkOverview());
    })
  );

  api.get('/admin/categories', (_req, res) => {
    res.json([...SYSTEM_CATEGORIES]);
  });

  api.get(
    '/admin/customers',
    asyncHandler(async (_req, res) => {
      res.json(await store.getCustomersRoster());
    })
  );

  api.get(
    '/admin/customers/:tenantId/guardrails',
    asyncHandler(async (req, res) => {
      res.json(await store.getCustomerGuardrails(req.params.tenantId));
    })
  );

  api.put(
    '/admin/customers/:tenantId/guardrails',
    asyncHandler(async (req, res) => {
      const allowed = Array.isArray(req.body?.allowed_categories) ? req.body.allowed_categories : [];
      res.json(await store.updateCustomerGuardrails(req.params.tenantId, allowed));
    })
  );

  api.get(
    '/admin/customers/:tenantId/categories',
    asyncHandler(async (req, res) => {
      res.json(await store.getCategoryRules(req.params.tenantId));
    })
  );

  const adminUpdateCategoryHandler = asyncHandler(async (req, res) => {
    const principal = resolvePrincipal(req);
    const updated = await store.updateCategoryRule(principal, req.params.tenantId, req.params.category, req.body || {});
    res.json(updated);
  });

  api.put('/admin/customers/:tenantId/categories/:category', adminUpdateCategoryHandler);
  api.patch('/admin/customers/:tenantId/categories/:category', adminUpdateCategoryHandler);

  api.get(
    '/admin/recurrent-grants',
    asyncHandler(async (_req, res) => {
      res.json(await store.getGrants());
    })
  );

  api.post(
    '/admin/recurrent-grants/:grantId/revoke',
    asyncHandler(async (req, res) => {
      res.json(await store.revokeGrant(req.params.grantId));
    })
  );

  api.get(
    '/admin/orders',
    asyncHandler(async (req, res) => {
      const tenantId = typeof req.query.tenant_id === 'string' ? req.query.tenant_id : undefined;
      const statusFilter =
        typeof req.query.status_filter === 'string' ? req.query.status_filter.toUpperCase() : undefined;
      res.json(await store.getOrders(tenantId, statusFilter));
    })
  );

  api.get(
    '/admin/audit_logs',
    asyncHandler(async (req, res) => {
      const limit = Number(req.query.limit || 100);
      res.json(await store.getAuditLogs(undefined, limit));
    })
  );

  const killswitchHandler = asyncHandler(async (req, res) => {
    const principal = resolvePrincipal(req);
    requirePrincipal(principal, ['admin']);
    const halted = Boolean(req.body?.halted);
    res.json(await store.setKillswitch(halted));
  });
  api.post('/admin/killswitch', killswitchHandler);
  api.post('/policies/killswitch', killswitchHandler);

  app.use('/api/v1', api);

  // Error Handler for GatewayError
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof GatewayError) {
      return res.status(err.status).json({ detail: err.message });
    }
    const message = err instanceof Error ? err.message : 'Internal server error';
    return res.status(500).json({ detail: message });
  });

  // Vite middleware in dev, static dist in prod
  if (process.env.SKIP_VITE !== 'true') {
    if (process.env.NODE_ENV !== 'production') {
      const { createServer: createViteServer } = await import('vite');
      const vite = await createViteServer({
        server: {
          middlewareMode: true,
          hmr: process.env.DISABLE_HMR === 'true' ? false : { server: httpServer },
        },
        appType: 'spa',
      });
      app.use(vite.middlewares);
    } else {
      const distPath = path.resolve(__dirname, 'dist');
      app.use(express.static(distPath));
      app.get('*', (_req, res) => {
        res.sendFile(path.join(distPath, 'index.html'));
      });
    }
  }

  return { app, httpServer, store };
}

export async function startServer() {
  const { httpServer } = await createApp();
  const PORT = Number(process.env.PORT || 3000);
  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`AimoGate server running on http://0.0.0.0:${PORT} (MCP: /mcp)`);

    // Ensure full catalog is loaded; if falling back to 8 staples, auto-pull full 17,546 catalog from upstream
    const catalog = ValioAimoCatalogService.getInstance();
    catalog.ensureLoaded();
    if (catalog.getProductCount() < 100) {
      console.log('[Startup] Catalog contains < 100 items; auto-pulling full 17,546 catalog from Valio Aimo API...');
      catalog.pullFromUpstream().catch((err) => console.warn('[Startup] Catalog auto-pull notice:', err.message));
    }
  });
}

if (process.env.NODE_ENV !== 'test' && !process.env.SKIP_SERVER_LISTEN) {
  startServer();
}
