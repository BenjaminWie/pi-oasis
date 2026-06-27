// Hosted MCP server over JSON-RPC (Streamable HTTP transport, POST-only).
// Auth: Bearer <mcp_token>. Each tool call is scoped to the token's device.
// We implement the small slice of the MCP wire protocol the major clients
// (Claude Desktop, ChatGPT custom GPTs, Gemini extensions) actually use:
// initialize, tools/list, tools/call.
//
// This is intentionally a hand-rolled JSON-RPC handler — Workers don't
// run the @modelcontextprotocol/sdk transport cleanly, and the wire is
// small enough to implement directly.

import { createFileRoute } from "@tanstack/react-router";
import { bearer, jsonResponse } from "@/lib/agent-api.server";
import {
  TOOLS,
  findTool,
  resolveToken,
  writeAudit,
  zodToJsonSchema,
  getToolsForDevice,
  type ToolCtx,
} from "@/lib/mcp-tools.server";

const PROTOCOL_VERSION = "2025-06-18";
const SERVER_INFO = { name: "pi-hub-mcp", version: "1.0.0" };

interface JsonRpcReq {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: any;
}

function rpcResult(id: any, result: any) {
  return { jsonrpc: "2.0" as const, id: id ?? null, result };
}
function rpcError(id: any, code: number, message: string, data?: any) {
  return {
    jsonrpc: "2.0" as const,
    id: id ?? null,
    error: { code, message, ...(data !== undefined ? { data } : {}) },
  };
}

async function handleRpc(msg: JsonRpcReq, ctx: ToolCtx | null) {
  const id = msg.id;
  switch (msg.method) {
    case "initialize":
      return rpcResult(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions:
          "Pi-Hub MCP server. Use get_device_info / get_status / list_plugins for read calls, and pump_set / container_action / mqtt_publish for control (requires the 'control' scope on the token). When the user asks about the pump or watering, prefer list_plugins → get_plugin → pump_set.",
      });

    case "notifications/initialized":
    case "notifications/cancelled":
      return null; // notifications get no response

    case "ping":
      return rpcResult(id, {});

    case "tools/list": {
      if (!ctx) return rpcError(id, -32001, "unauthorized");
      const allTools = await getToolsForDevice(ctx);
      const available = allTools.filter((t) => ctx.scopes.includes(t.scope));
      return rpcResult(id, {
        tools: available.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: zodToJsonSchema(t.inputSchema),
        })),
      });
    }

    case "tools/call": {
      if (!ctx) return rpcError(id, -32001, "unauthorized");
      const name = msg.params?.name;
      const args = msg.params?.arguments ?? {};
      const tool = await findTool(name, ctx);
      if (!tool) {
        await writeAudit(ctx, String(name ?? "?"), "error", 0, "unknown tool");
        return rpcError(id, -32602, `unknown tool: ${name}`);
      }
      if (!ctx.scopes.includes(tool.scope)) {
        await writeAudit(ctx, tool.name, "denied", 0, `missing scope ${tool.scope}`);
        return rpcError(id, -32001, `tool requires scope: ${tool.scope}`);
      }
      let parsed: any;
      try {
        parsed = tool.inputSchema.parse(args);
      } catch (e: any) {
        await writeAudit(ctx, tool.name, "error", 0, "invalid arguments");
        return rpcError(id, -32602, "invalid arguments", e?.errors ?? e?.message);
      }
      const t0 = Date.now();
      try {
        const out = await tool.execute(parsed, ctx);
        const latency = Date.now() - t0;
        await writeAudit(ctx, tool.name, "ok", latency);
        return rpcResult(id, {
          content: [{ type: "text", text: JSON.stringify(out, null, 2) }],
          structuredContent: out,
          isError: false,
        });
      } catch (e: any) {
        const latency = Date.now() - t0;
        const msg = String(e?.message || e);
        await writeAudit(ctx, tool.name, "error", latency, msg);
        return rpcResult(id, {
          content: [{ type: "text", text: `Error: ${msg}` }],
          isError: true,
        });
      }
    }

    default:
      return rpcError(id, -32601, `method not found: ${msg.method}`);
  }
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, Mcp-Session-Id",
  "Access-Control-Max-Age": "86400",
};

function methodNotAllowed() {
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed. Use POST." },
      id: null,
    }),
    { status: 405, headers: { ...CORS_HEADERS, "Content-Type": "application/json", Allow: "POST, OPTIONS" } },
  );
}

export const Route = createFileRoute("/api/public/mcp")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS_HEADERS }),
      GET: async () => methodNotAllowed(),
      DELETE: async () => methodNotAllowed(),
      POST: async ({ request }) => {
        // Auth — required for everything except a bare initialize ping
        const token = bearer(request);
        let ctx: ToolCtx | null = null;
        if (token) {
          const r = await resolveToken(token);
          if (r.ok) ctx = r.ctx;
        }

        let body: any;
        try {
          body = await request.json();
        } catch {
          return jsonResponse(rpcError(null, -32700, "parse error"), {
            status: 400,
            headers: CORS_HEADERS,
          });
        }

        const isBatch = Array.isArray(body);
        const items: JsonRpcReq[] = isBatch ? body : [body];

        // For non-initialize requests we require a valid token
        const needsAuth = items.some(
          (m) => m.method !== "initialize" && !m.method?.startsWith("notifications/"),
        );
        if (needsAuth && !ctx) {
          return new Response(
            JSON.stringify(rpcError(items[0]?.id ?? null, -32001, "unauthorized")),
            { status: 401, headers: { ...CORS_HEADERS, "Content-Type": "application/json", "WWW-Authenticate": "Bearer" } },
          );
        }

        const responses = (
          await Promise.all(items.map((m) => handleRpc(m, ctx)))
        ).filter((r) => r !== null);

        if (responses.length === 0) {
          return new Response(null, { status: 202, headers: CORS_HEADERS });
        }

        return new Response(
          JSON.stringify(isBatch ? responses : responses[0]),
          { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
        );
      },
    },
  },
});
