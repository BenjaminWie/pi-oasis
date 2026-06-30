// Pi-local Node-RED fallback ingest. Keeps events in RAM only so the SD card
// is not used. In cloud deployments it requires PI_INGEST_TOKEN; without a
// token it only accepts localhost/private-LAN requests by Host/IP headers.
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { bearer, jsonResponse } from "@/lib/agent-api.server";

const Single = z.object({
  component: z.string().min(1).max(64),
  device: z.string().max(64).optional(),
  status: z.string().min(1).max(32),
  message: z.string().max(2048).optional(),
  strategy_applied: z.string().max(64).optional(),
  metrics: z.record(z.string(), z.unknown()).optional(),
  ts: z.string().datetime().optional(),
});

const Body = z.union([Single, z.array(Single).min(1).max(50)]);

function isPrivateHost(host: string | null) {
  const h = (host ?? "").split(":")[0];
  return (
    h === "localhost" ||
    h === "127.0.0.1" ||
    h.startsWith("192.168.") ||
    h.startsWith("10.") ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h)
  );
}

function isPrivateCaller(request: Request) {
  const host = request.headers.get("host");
  const ip =
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-real-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    null;
  return isPrivateHost(host) || isPrivateHost(ip);
}

export const Route = createFileRoute("/api/public/ingest/event")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env.PI_INGEST_TOKEN || process.env.PI_LOCAL_INGEST_TOKEN || "";
        if (expected) {
          if (bearer(request) !== expected) return jsonResponse({ error: "unauthorized" }, 401);
        } else if (!isPrivateCaller(request)) {
          return jsonResponse({ error: "local ingest only" }, 403);
        }

        let parsed;
        try {
          parsed = Body.parse(await request.json());
        } catch (e: any) {
          return jsonResponse({ error: "invalid body", detail: String(e?.message ?? e) }, 400);
        }

        const now = new Date().toISOString();
        const events = (Array.isArray(parsed) ? parsed : [parsed]).map((e) => ({
          ...e,
          ts: e.ts ?? now,
          receivedAt: now,
          metrics: e.metrics ?? {},
        }));
        const { pushLocalIngest } = await import("@/lib/local-ingest-buffer.server");
        pushLocalIngest(events);
        return jsonResponse({ ok: true, buffered: events.length, storage: "ram" });
      },
    },
  },
});
