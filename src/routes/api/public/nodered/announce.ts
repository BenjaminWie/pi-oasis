// Node-RED self-announce + value push. Pi-local, no database.
//
// POST /api/public/nodered/announce
//   { source?: "nodered", replace?: true, endpoints: [ { id, label, kind, ... } ] }
//
// POST /api/public/nodered/announce?values=1  (or body { values: [...] })
//   { values: [ { id, value } ] }
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { guardLocalIngest } from "@/lib/local-ingest-guard.server";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

const Endpoint = z.object({
  id: z.string().min(1).max(64),
  label: z.string().max(80).optional(),
  kind: z.enum(["read", "switch", "number", "action"]).optional(),
  unit: z.string().max(16).optional(),
  min: z.number().finite().optional(),
  max: z.number().finite().optional(),
  options: z.array(z.string().max(40)).max(20).optional(),
  group: z.string().max(40).optional(),
  description: z.string().max(200).optional(),
  invoke: z
    .object({
      url: z.string().url().optional(),
      method: z.enum(["GET", "POST"]).optional(),
      mqttTopic: z.string().max(200).optional(),
      mqttBrokerId: z.string().max(80).optional(),
    })
    .optional(),
  value: z.unknown().optional(),
});

const Body = z.object({
  source: z.string().max(40).optional(),
  replace: z.boolean().optional(),
  endpoints: z.array(Endpoint).max(200).optional(),
  values: z
    .array(z.object({ id: z.string().min(1).max(64), value: z.unknown() }))
    .max(200)
    .optional(),
});

export const Route = createFileRoute("/api/public/nodered/announce")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
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

        const reg = await import("@/lib/registry.server");
        const out: Record<string, unknown> = { ok: true };

        if (body.endpoints?.length) {
          const res = reg.announceEndpoints(body.endpoints, {
            source: body.source,
            replace: body.replace,
          });
          for (const e of body.endpoints) {
            if (e.value !== undefined) reg.setEndpointValue(e.id, e.value);
          }
          Object.assign(out, res);
        }

        if (body.values?.length) {
          let applied = 0;
          for (const v of body.values) if (reg.setEndpointValue(v.id, v.value)) applied++;
          out.valuesApplied = applied;
        }

        return Response.json(out, { headers: { ...CORS, "cache-control": "no-store" } });
      },
    },
  },
});
