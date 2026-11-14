import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { GatewayError } from './aimogate.ts';
import { preprocessBuyerPrompt } from './promptPreprocessor.ts';
import type { PersistentAimoGateStore } from './firestoreStore.ts';
import type { Principal } from '../types/aimogate.ts';

export function createAimoGateMcpServer(
  store: PersistentAimoGateStore,
  principal: Principal
): McpServer {
  const server = new McpServer({
    name: 'aimogate-valio-aimo',
    version: '1.0.0',
  });

  server.registerTool(
    'search_offers',
    {
      title: 'Search Valio Aimo Contract Offers',
      description:
        'Query active, tenant-authorized Valio Aimo wholesale SKUs with unit-normalized €/L pricing, pack-quantity calculation, stock availability, and lead-time checks. Internal margins and unreleased roadmap products are redacted.',
      inputSchema: {
        query: z.string().optional().describe('Product search query, e.g. "lactose-free milk" or "oat"'),
        attributes: z.array(z.string()).optional().describe('Dietary/product attributes, e.g. ["lactose-free"]'),
        required_volume_litres: z
          .number()
          .positive()
          .optional()
          .describe('Target order volume in litres for pack normalization'),
        deliver_by: z
          .string()
          .optional()
          .describe('Target delivery timestamp in ISO-8601 format'),
      },
    },
    async ({ query, attributes, required_volume_litres, deliver_by }) => {
      try {
        const offers = await store.searchOffers(principal, {
          query,
          attributes,
          required_volume_litres,
          deliver_by,
        });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  tenant_id: principal.tenant_id,
                  principal_type: principal.principal_type,
                  offer_count: offers.length,
                  offers,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err) {
        const message = err instanceof GatewayError ? `${err.status}: ${err.message}` : String(err);
        return { isError: true, content: [{ type: 'text', text: message }] };
      }
    }
  );

  server.registerTool(
    'lock_quote',
    {
      title: 'Lock Two-Phase Quote & Reserve Stock',
      description:
        'Atomically reserve warehouse packs at the customer contract price for 15 minutes before order commitment.',
      inputSchema: {
        sku: z.string().min(1).describe('Valio Aimo SKU identifier, e.g. VA-LF-MILK-10L'),
        pack_quantity: z.number().int().positive().describe('Number of wholesale packs to reserve'),
        deliver_by: z.string().min(1).describe('Requested delivery timestamp (ISO-8601)'),
      },
    },
    async ({ sku, pack_quantity, deliver_by }) => {
      try {
        const quote = await store.lockQuote(principal, { sku, pack_quantity, deliver_by });
        return {
          content: [{ type: 'text', text: JSON.stringify(quote, null, 2) }],
        };
      } catch (err) {
        const message = err instanceof GatewayError ? `${err.status}: ${err.message}` : String(err);
        return { isError: true, content: [{ type: 'text', text: message }] };
      }
    }
  );

  server.registerTool(
    'commit_order',
    {
      title: 'Commit Order Through Policy Firewall',
      description:
        'Submit a locked quote with an idempotent PO reference. Evaluates spend caps, volume caps, category whitelists, recurrent grants, and killswitch status. Orders exceeding limits are held as PENDING_APPROVAL for human F&B manager sign-off.',
      inputSchema: {
        quote_id: z.string().min(1).describe('Locked quote ID returned by lock_quote'),
        po_reference: z.string().min(1).describe('Unique buyer PO reference for idempotency'),
      },
    },
    async ({ quote_id, po_reference }) => {
      try {
        const order = await store.commitOrder(principal, { quote_id, po_reference });
        return {
          content: [{ type: 'text', text: JSON.stringify(order, null, 2) }],
        };
      } catch (err) {
        const message = err instanceof GatewayError ? `${err.status}: ${err.message}` : String(err);
        return { isError: true, content: [{ type: 'text', text: message }] };
      }
    }
  );

  server.registerTool(
    'get_tenant_policy',
    {
      title: 'Read Tenant Autonomous Policy Limits',
      description:
        'Inspect the buyer tenant autonomous spend cap, volume cap, and allowed product categories (read-only).',
      inputSchema: {},
    },
    async () => {
      try {
        const policy = await store.getPolicy(principal.tenant_id);
        return {
          content: [{ type: 'text', text: JSON.stringify(policy, null, 2) }],
        };
      } catch (err) {
        const message = err instanceof GatewayError ? `${err.status}: ${err.message}` : String(err);
        return { isError: true, content: [{ type: 'text', text: message }] };
      }
    }
  );

  server.registerTool(
    'preprocess_prompt',
    {
      title: 'Analyze Buyer Prompt & Extract Intent via Gemini API',
      description:
        'Passes a natural language procurement instruction or recipe to Gemini API with prompt injection guardrails, returning structured intent, culinary dishes, scaled line items, and normalized units.',
      inputSchema: {
        prompt: z.string().min(1).describe('Natural language procurement prompt or recipe text'),
      },
    },
    async ({ prompt }) => {
      try {
        const result = await preprocessBuyerPrompt(prompt);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        const message = err instanceof GatewayError ? `${err.status}: ${err.message}` : String(err);
        return { isError: true, content: [{ type: 'text', text: message }] };
      }
    }
  );

  return server;
}
