// Usage & cost dashboard. Focuses on measurable DB-write volume, which is
// what our credit spend tracks day-to-day. AI Gateway per-token spend lives
// in the workspace credit view outside the app.

import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Activity, AlertTriangle, Zap } from "lucide-react";
import { getUsageSummary } from "@/lib/usage.functions";

export const Route = createFileRoute("/_cloud/connections/usage")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Usage — Pi-Hub Kosten & DB-Writes" },
      { name: "description", content: "Wieviel schreiben Alexa, Telegram, MCP und das Gerät heute in die Cloud? Zero-Wake Health Meter." },
      { property: "og:title", content: "Pi-Hub Usage" },
      { property: "og:description", content: "Live DB-write Zähler pro Quelle." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: UsagePage,
});

function Sparkline({ series }: { series: { day: string; count: number }[] }) {
  if (!series.length) return <div className="text-[10px] text-muted-foreground">— keine Daten —</div>;
  const max = Math.max(...series.map((s) => s.count), 1);
  return (
    <div className="flex items-end gap-1 h-16">
      {series.slice(-14).map((s) => (
        <div key={s.day} className="flex-1 flex flex-col items-center gap-1" title={`${s.day}: ${s.count}`}>
          <div
            className="w-full rounded-t bg-primary/60"
            style={{ height: `${Math.max(2, (s.count / max) * 100)}%` }}
          />
          <div className="text-[9px] text-muted-foreground">{s.day.slice(5)}</div>
        </div>
      ))}
    </div>
  );
}

function UsagePage() {
  const usageFn = useServerFn(getUsageSummary);
  const { data, isLoading, error } = useQuery({
    queryKey: ["usage-summary"],
    queryFn: () => usageFn(),
    staleTime: 60_000,
  });

  return (
    <div className="px-5 space-y-4">
      <div>
        <h2 className="text-xs uppercase tracking-widest text-muted-foreground mb-1">
          Usage & Kosten
        </h2>
        <p className="text-xs text-muted-foreground">
          DB-Writes pro Quelle. Zero-Wake Ziel: möglichst wenig pro Tag.
        </p>
      </div>

      {isLoading && <div className="text-xs text-muted-foreground">Lade…</div>}
      {error && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
          {String((error as Error).message)}
        </div>
      )}

      {data && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <StatCard label="MCP Audit (heute)" value={data.last24h.totals.mcpAudit} icon={<Zap className="size-4" />} />
            <StatCard label="Telegram Audit" value={data.last24h.totals.telegramAudit} icon={<Zap className="size-4" />} />
            <StatCard label="Device Events" value={data.last24h.totals.deviceEvents} icon={<Activity className="size-4" />} />
            <StatCard label="Pump Sessions" value={data.last24h.totals.pumpSessions} icon={<Activity className="size-4" />} />
          </div>

          <Section title="Eingang pro Komponente (zuletzt)">
            {data.ingest.components.length === 0 ? (
              <div className="text-xs text-muted-foreground">Kein Eingang in 14 Tagen.</div>
            ) : (
              <table className="w-full text-xs">
                <tbody>
                  {data.ingest.components.map((c) => {
                    const ageMin = Math.round((Date.now() - new Date(c.lastAt).getTime()) / 60_000);
                    const stale = ageMin > 180;
                    return (
                      <tr key={c.component} className="border-t border-border first:border-0">
                        <td className="py-1.5 font-mono">{c.component}</td>
                        <td className={`py-1.5 text-right ${stale ? "text-destructive" : "text-muted-foreground"}`}>
                          {ageMin < 60 ? `vor ${ageMin} Min` : `vor ${Math.round(ageMin / 60)} Std`}
                        </td>
                      </tr>
                    );
                  })}
                  {data.ingest.state.map((s) => (
                    <tr key={s.deviceId} className="border-t border-border">
                      <td className="py-1.5 font-mono">system (live-relay)</td>
                      <td
                        className={`py-1.5 text-right ${
                          s.sysUpdatedAt ? "text-muted-foreground" : "text-destructive"
                        }`}
                      >
                        {s.sysUpdatedAt
                          ? `vor ${Math.round((Date.now() - new Date(s.sysUpdatedAt).getTime()) / 60_000)} Min`
                          : "nie"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>

          <Section title="Nach Quelle (letzte 24h)">

            {data.last24h.bySource.length === 0 ? (
              <div className="text-xs text-muted-foreground">Keine Tool-Aufrufe.</div>
            ) : (
              <table className="w-full text-xs">
                <thead className="text-muted-foreground">
                  <tr className="text-left">
                    <th className="py-1">Quelle</th>
                    <th className="py-1 text-right">Calls</th>
                    <th className="py-1 text-right">Fehler</th>
                  </tr>
                </thead>
                <tbody>
                  {data.last24h.bySource.map((r) => (
                    <tr key={r.source} className="border-t border-border">
                      <td className="py-1.5">{r.source}</td>
                      <td className="py-1.5 text-right font-mono">{r.calls}</td>
                      <td className="py-1.5 text-right font-mono">
                        {r.errors > 0 ? (
                          <span className="text-destructive inline-flex items-center gap-1">
                            <AlertTriangle className="size-3" />
                            {r.errors}
                          </span>
                        ) : (
                          "0"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>

          <Section title="MCP Audit — 14 Tage">
            <Sparkline series={data.series.mcpAudit} />
          </Section>
          <Section title="Device Events — 14 Tage">
            <Sparkline series={data.series.deviceEvents} />
          </Section>
          <Section title="Pump Sessions — 14 Tage">
            <Sparkline series={data.series.pumpSessions} />
          </Section>

          <div className="rounded-2xl border border-border bg-card/60 p-3 text-[11px] text-muted-foreground leading-relaxed">
            <p className="font-bold text-foreground mb-1">Was fehlt?</p>
            <p>
              Der Lovable AI Gateway Credit-Verbrauch (LLM-Tokens) ist nur im Workspace-Billing sichtbar,
              nicht in der App-API. Diese Ansicht zeigt DB-Write-Volumen — das ist der Haupthebel für unsere
              Zero-Wake-Rechnung.
            </p>
          </div>
        </>
      )}
    </div>
  );
}

function StatCard({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-3">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="mt-1 text-2xl font-bold tabular-nums">{value}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-3">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">{title}</div>
      {children}
    </div>
  );
}
