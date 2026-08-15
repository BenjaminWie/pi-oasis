// Usage dashboard: DB-write counters per source per day. Serves as our
// "Zero-Wake" health meter. Lovable AI Gateway credit balance is not exposed
// through app-side APIs; this dashboard focuses on what we CAN measure:
// row-write volume in the tables that drive our credit spend.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Counts = { day: string; count: number };

async function countByDay(
  supabase: any,
  table: string,
  tsCol: string,
  days: number,
): Promise<Counts[]> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const { data, error } = await supabase
    .from(table)
    .select(tsCol)
    .gte(tsCol, since)
    .limit(5000);
  if (error) return [];
  const buckets = new Map<string, number>();
  for (const row of data as Array<Record<string, string>>) {
    const day = (row[tsCol] as string).slice(0, 10);
    buckets.set(day, (buckets.get(day) ?? 0) + 1);
  }
  return Array.from(buckets.entries())
    .map(([day, count]) => ({ day, count }))
    .sort((a, b) => a.day.localeCompare(b.day));
}

export const getUsageSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const s = context.supabase;
    const [mcpAudit, telegramAudit, deviceEvents, pumpSessions] = await Promise.all([
      countByDay(s, "mcp_audit", "created_at", 14),
      countByDay(s, "telegram_audit", "created_at", 14),
      countByDay(s, "device_events", "created_at", 14),
      countByDay(s, "pump_sessions", "created_at", 14),
    ]);

    // By source, last 24h from mcp_audit joined via mcp_tokens.source
    const since = new Date(Date.now() - 86_400_000).toISOString();
    const { data: auditRows } = await s
      .from("mcp_audit")
      .select("token_id, tool, status, latency_ms, created_at")
      .gte("created_at", since)
      .limit(2000);

    const tokenIds = Array.from(new Set(((auditRows ?? []) as any[]).map((r) => r.token_id).filter(Boolean)));
    const sourceByToken = new Map<string, string>();
    if (tokenIds.length) {
      const { data: tokens } = await s
        .from("mcp_tokens")
        .select("id, source")
        .in("id", tokenIds);
      for (const t of (tokens ?? []) as any[]) sourceByToken.set(t.id, t.source ?? "unknown");
    }

    const bySource = new Map<string, { calls: number; errors: number }>();
    for (const r of (auditRows ?? []) as any[]) {
      const src = r.token_id ? sourceByToken.get(r.token_id) ?? "unknown" : "chat";
      const cur = bySource.get(src) ?? { calls: 0, errors: 0 };
      cur.calls += 1;
      if (r.status === "error") cur.errors += 1;
      bySource.set(src, cur);
    }

    // Ingest health: when did each component last send something? A branch of
    // the Node-RED flow that dies is otherwise invisible for days.
    const { data: recent } = await s
      .from("device_events")
      .select("component, occurred_at")
      .gte("occurred_at", new Date(Date.now() - 14 * 86_400_000).toISOString())
      .order("occurred_at", { ascending: false })
      .limit(2000);
    const lastByComponent = new Map<string, string>();
    for (const r of (recent ?? []) as any[]) {
      if (!lastByComponent.has(r.component)) lastByComponent.set(r.component, r.occurred_at);
    }
    const { data: stateRows } = await s
      .from("device_state_latest")
      .select("device_id, updated_at, sys_updated_at, cpu_pct, mem_pct, disk_pct, temp_c")
      .limit(20);

    return {
      series: { mcpAudit, telegramAudit, deviceEvents, pumpSessions },
      ingest: {
        components: Array.from(lastByComponent.entries())
          .map(([component, lastAt]) => ({ component, lastAt }))
          .sort((a, b) => b.lastAt.localeCompare(a.lastAt)),
        state: ((stateRows ?? []) as any[]).map((r) => ({
          deviceId: r.device_id,
          updatedAt: r.updated_at,
          sysUpdatedAt: r.sys_updated_at,
          cpu: r.cpu_pct,
          mem: r.mem_pct,
          disk: r.disk_pct,
          temp: r.temp_c,
        })),
      },
      last24h: {
        totals: {
          mcpAudit: mcpAudit.filter((d) => d.day === todayISO()).reduce((a, b) => a + b.count, 0),
          telegramAudit: telegramAudit.filter((d) => d.day === todayISO()).reduce((a, b) => a + b.count, 0),
          deviceEvents: deviceEvents.filter((d) => d.day === todayISO()).reduce((a, b) => a + b.count, 0),
          pumpSessions: pumpSessions.filter((d) => d.day === todayISO()).reduce((a, b) => a + b.count, 0),
        },
        bySource: Array.from(bySource.entries()).map(([source, v]) => ({ source, ...v })),
      },
    };
  });


function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

// Chat preflight — DATABASE-FREE: checks that the relay to the Pi is
// configured and answering, so the assistant page can name the real reason.
export const chatPreflight = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { piConfig, getPiState } = await import("@/lib/pi-relay.server");
    const cfg = piConfig();
    if (!cfg.configured) return { ok: false, code: "no_paired_device" as const };
    const probe = await getPiState();
    if (!probe.ok) return { ok: false, code: "pi_offline" as const };
    return {
      ok: true as const,
      device: {
        id: "pi",
        name: cfg.url.replace(/^https?:\/\//, ""),
        last_seen_at: probe.stale ? null : new Date().toISOString(),
      },
    };
  });

