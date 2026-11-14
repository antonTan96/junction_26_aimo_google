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
import { PersistentAimoGateStore } from './src/lib/firestoreStore.ts';
import { createAimoGateMcpServer } from './src/lib/mcpServer.ts';
import type { Principal, PrincipalType } from './src/types/aimogate.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const store = new PersistentAimoGateStore();

function resolvePrincipal(req: Request): Principal {
  const auth = req.headers.authorization;
  const queryTenant = typeof req.query.tenant_id === 'string' ? req.query.tenant_id : undefined;

  if (!auth || !auth.startsWith('Bearer ')) {
    return store.engine.getPresetPrincipal('agent', queryTenant || DEFAULT_TENANT_ID);
  }

  const token = auth.slice('Bearer '.length).trim();
  const parts = token.split('.');
  if (parts.length >= 3 && parts[0] === 'aimo') {
    const role = parts[1] as PrincipalType;
    const tokenTenant = parts.slice(2).join('.') || DEFAULT_TENANT_ID;
    if (role === 'agent' || role === 'human' || role === 'admin') {
      return store.engine.getPresetPrincipal(role, queryTenant || tokenTenant);
    }
  }

  throw new GatewayError(401, 'Invalid or unrecognized bearer token.');
}

const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

async function startServer() {
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

  // --- Tools (Agent REST Gateway) ---
  api.post(
    '/tools/search_offers',
    asyncHandler(async (req, res) => {
      const principal = resolvePrincipal(req);
      const offers = await store.searchOffers(principal, req.body || {});
      res.json(offers);
    })
  );

  api.post(
    '/tools/lock_quote',
    asyncHandler(async (req, res) => {
      const principal = resolvePrincipal(req);
      const quote = await store.lockQuote(principal, req.body);
      res.json(quote);
    })
  );

  api.post(
    '/tools/commit_order',
    asyncHandler(async (req, res) => {
      const principal = resolvePrincipal(req);
      const order = await store.commitOrder(principal, req.body);
      res.json(order);
    })
  );

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

  api.patch(
    '/policies',
    asyncHandler(async (req, res) => {
      const principal = resolvePrincipal(req);
      const targetTenant = typeof req.query.tenant_id === 'string' ? req.query.tenant_id : principal.tenant_id;
      const updated = await store.updatePolicy(principal, targetTenant, req.body || {});
      res.json(updated);
    })
  );

  // --- Autonomous Buyer Agent & Scheduled Prompts ---
  api.post(
    '/agent/run',
    asyncHandler(async (req, res) => {
      res.json(await store.runAgentWorkflow(req.body || {}));
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

  api.post(
    '/admin/killswitch',
    asyncHandler(async (req, res) => {
      const halted = Boolean(req.body?.halted);
      res.json(await store.setKillswitch(halted));
    })
  );

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

  const PORT = Number(process.env.PORT || 3000);
  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`AimoGate server running on http://0.0.0.0:${PORT} (MCP: /mcp)`);
  });
}

startServer();
