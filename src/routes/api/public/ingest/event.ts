// Loopback-only ingestion endpoint. Designed for Node-RED (or any local
// process) on the same Pi to POST structured events. Three security layers:
//   1. Remote address must be loopback (127.0.0.1 / ::1).
//   2. Bearer token must match PI_INGEST_TOKEN (timing-safe compare).
//   3. Strict zod schema; unknown fields rejected.
//
// Nothing is written to disk — the event is appended to an in-memory ring
// buffer and fire-and-forget forwarded to the cloud through the existing
// device-token cloud bridge.

import { createFileRoute } from "@tanstack/react-router";
import { getRequestIP } from "@tanstack/react-start/server";
import { z } from "zod";
import { createHash, timingSafeEqual } from "node:crypto";
import { bearer, jsonResponse } from "@/lib/agent-api.server";

const Body = z
  .object({
    component: z.string().min(1).max(64),
    device: z.string().min(1).max(64),
    timestamp: z.string().datetime({ offset: true }).optional(),
    status: z.enum(["healthy", "warning", "critical", "info"]),
    metrics: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])).default({}),
  })
  .strict();

function isLoopback(ip: string | undefined): boolean {
  if (!ip) return false;
  return (
    ip === "127.0.0.1" ||
    ip === "::1" ||
    ip === "::ffff:127.0.0.1" ||
    ip.startsWith("127.")
  );
}

function tokenMatches(provided: string): boolean {
  const expected = process.env.PI_INGEST_TOKEN;
  if (!expected) return false;
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return a.length === b.length && timingSafeEqual(a, b);
}

// crude in-memory rate limit (per process): 20 req/s burst
let bucketTs = Date.now();
let bucketCount = 0;
function allowRate(): boolean {
  const now = Date.now();
  if (now - bucketTs > 1000) {
    bucketTs = now;
    bucketCount = 0;
  }
  bucketCount++;
  return bucketCount <= 20;
}

export const Route = createFileRoute("/api/public/ingest/event")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const ip = getRequestIP({ xForwardedFor: false });
        if (!isLoopback(ip)) {
          return jsonResponse({ error: "loopback only" }, 403);
        }
        const tok = bearer(request);
        if (!tok || !tokenMatches(tok)) {
          return jsonResponse({ error: "unauthorized" }, 401);
        }
        if (!allowRate()) {
          return jsonResponse({ error: "rate limited" }, 429);
        }
        let json: unknown;
        try {
          json = await request.json();
        } catch {
          return jsonResponse({ error: "invalid json" }, 400);
        }
        const parsed = Body.safeParse(json);
        if (!parsed.success) {
          return jsonResponse({ error: "invalid payload", detail: parsed.error.flatten() }, 400);
        }
        const { pushEvent } = await import("@/lib/ingest-buffer.server");
        const ev = pushEvent({
          component: parsed.data.component,
          device: parsed.data.device,
          status: parsed.data.status,
          timestamp: parsed.data.timestamp ?? new Date().toISOString(),
          metrics: parsed.data.metrics,
        });
        return jsonResponse({ ok: true, id: ev.id });
      },
    },
  },
});
