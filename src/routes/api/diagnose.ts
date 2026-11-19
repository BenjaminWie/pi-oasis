// POST { logs, attempted?, includeConfig } → streamed Markdown diagnosis.
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const Body = z.object({
  logs: z.string().trim().min(1).max(20000),
  attempted: z.string().max(500).optional(),
  includeConfig: z.boolean().default(true),
});

function err(code: string, error: string, status: number) {
  return Response.json({ code, error }, { status });
}

export const Route = createFileRoute("/api/diagnose")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { verifyPiToken } = await import("@/lib/pi-auth.server");
        const { hasProcStats } = await import("@/lib/pi-runtime.server");
        const isDev = process.env.NODE_ENV === "development";
        if (hasProcStats() && !isDev && !verifyPiToken(request.headers.get("x-pi-auth"))) {
          return err("unauthorized", "Bitte erneut mit PIN anmelden.", 401);
        }
        let body: z.infer<typeof Body>;
        try {
          body = Body.parse(await request.json());
        } catch {
          return err("bad_input", "Bitte ein Fehlerprotokoll eingeben (max. 20.000 Zeichen).", 400);
        }
        let config: unknown;
        if (body.includeConfig) {
          const { listEndpoints, registryInfo } = await import("@/lib/registry.server");
          config = {
            registry: registryInfo(),
            endpoints: listEndpoints().map((e) => ({
              id: e.id, label: e.label, kind: e.kind, unit: e.unit, min: e.min, max: e.max,
              source: e.source, value: e.value, valueAt: e.valueAt, lastSeenAt: e.lastSeenAt,
              voice: e.voice, control: e.control, invoke: e.invoke, config: e.config,
            })),
          };
        }
        try {
          const { diagnoseStream } = await import("@/lib/diagnose-brain.server");
          const result = diagnoseStream({ logs: body.logs, attempted: body.attempted, config });
          return result.toTextStreamResponse();
        } catch (e: unknown) {
          return err("ai_error", String((e as Error)?.message ?? e), 500);
        }
      },
    },
  },
});
