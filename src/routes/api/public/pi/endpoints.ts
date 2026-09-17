// Pi-side endpoint catalogue + invoke for the cloud router.
// GET  → what exists and its current value (only voice-exposed endpoints)
// POST → { id, value } executes one endpoint
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { guardLocalIngest } from "@/lib/local-ingest-guard.server";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, x-pi-control-via",
};

const Body = z.object({
  id: z.string().min(1).max(64),
  value: z.union([z.string(), z.number(), z.boolean()]).optional(),
});

export const Route = createFileRoute("/api/public/pi/endpoints")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      GET: async ({ request }) => {
        const denied = guardLocalIngest(request);
        if (denied) return Response.json({ error: denied }, { status: 401, headers: CORS });
        const { voiceSnapshot, registryInfo, debugLogVerbose, asChannel } = await import(
          "@/lib/registry.server"
        );
        const { ensureSystemLoop } = await import("@/lib/system-endpoints.server");
        ensureSystemLoop();
        const ch = asChannel(request.headers.get("x-pi-control-via"));
        debugLogVerbose("in", "Katalog gelesen", { via: ch }, ch);
        return Response.json(
          { ts: new Date().toISOString(), endpoints: voiceSnapshot(), registry: registryInfo() },
          { headers: { ...CORS, "cache-control": "no-store" } },
        );
      },
      POST: async ({ request }) => {
        const denied = guardLocalIngest(request);
        if (denied) return Response.json({ error: denied }, { status: 401, headers: CORS });
        let body: z.infer<typeof Body>;
        try {
          body = Body.parse(await request.json());
        } catch (e: unknown) {
          return Response.json(
            { error: "invalid body", detail: String((e as Error)?.message ?? e) },
            { status: 400, headers: CORS },
          );
        }
        const { invokeEndpoint } = await import("@/lib/registry.server");
        const via = request.headers.get("x-pi-control-via") || "cloud";
        const out = await invokeEndpoint(body.id, body.value ?? true, { via });
        return Response.json(out, { status: out.ok ? 200 : 400, headers: CORS });
      },
    },
  },
});
