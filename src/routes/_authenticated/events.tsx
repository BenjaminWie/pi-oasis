// Live event feed: polls the in-memory ingest buffer every 2s. Shows
// pump_monitor / other Node-RED events along with their cloud-forward state.
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import {
  Activity,
  Cloud,
  CloudOff,
  AlertTriangle,
  CheckCircle2,
  Info,
  XCircle,
} from "lucide-react";
import { getIngestEvents, getIngestStatus } from "@/lib/cloud/events.functions";

export const Route = createFileRoute("/_authenticated/events")({
  component: EventsPage,
});

const STATUS_COLOR: Record<string, string> = {
  healthy: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  info: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  warning: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  critical: "bg-rose-500/15 text-rose-300 border-rose-500/30",
};

const STATUS_ICON: Record<string, typeof CheckCircle2> = {
  healthy: CheckCircle2,
  info: Info,
  warning: AlertTriangle,
  critical: XCircle,
};

function fmtMetrics(m: Record<string, number | string | boolean>) {
  const units: Record<string, string> = {
    watt: " W",
    voltage: " V",
    today_kwh: " kWh",
    temp: " °C",
    humidity: " %",
  };
  return Object.entries(m)
    .map(([k, v]) => `${v}${units[k] ?? ""}`)
    .join(" · ");
}

function EventsPage() {
  const eventsFn = useServerFn(getIngestEvents);
  const statusFn = useServerFn(getIngestStatus);
  const [filter, setFilter] = useState<string>("all");
  const [open, setOpen] = useState<number | null>(null);

  const status = useQuery({
    queryKey: ["ingest-status"],
    queryFn: () => statusFn(),
    refetchInterval: 5000,
  });

  const events = useQuery({
    queryKey: ["ingest-events"],
    queryFn: () => eventsFn({ data: { sinceId: 0 } }),
    refetchInterval: 2000,
    refetchIntervalInBackground: false,
  });

  const list = useMemo(() => {
    const all = [...(events.data?.events ?? [])].reverse();
    if (filter === "all") return all;
    return all.filter((e) => e.status === filter);
  }, [events.data, filter]);

  const components = useMemo(() => {
    const set = new Set((events.data?.events ?? []).map((e) => e.component));
    return Array.from(set);
  }, [events.data]);

  return (
    <div className="px-4 pt-6 pb-24">
      <header className="mb-6 pt-2">
        <div className="relative pl-3">
          <div className="absolute -left-0 top-0 w-0.5 h-full bg-primary/40 rounded-full" />
          <h2 className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground mb-1">
            Device Events
          </h2>
          <h1 className="text-2xl font-bold tracking-tight">Live Feed</h1>
        </div>
      </header>

      <div className="grid grid-cols-3 gap-2 mb-4 text-xs">
        <StatCard icon={Activity} label="Buffered" value={status.data?.stats.buffered ?? 0} />
        <StatCard
          icon={status.data?.cloudPaired ? Cloud : CloudOff}
          label="Forwarded"
          value={status.data?.stats.forwarded ?? 0}
          accent={status.data?.cloudPaired ? "text-emerald-300" : "text-muted-foreground"}
        />
        <StatCard
          icon={AlertTriangle}
          label={status.data?.stats.queued ? "Queued" : "Dropped"}
          value={status.data?.stats.queued || status.data?.stats.dropped || 0}
          accent={status.data?.stats.dropped ? "text-rose-300" : "text-muted-foreground"}
        />
      </div>

      {!status.data?.tokenConfigured && (
        <div className="mb-4 p-3 rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-200 text-xs">
          <strong className="font-semibold">PI_INGEST_TOKEN nicht gesetzt.</strong> Trag den Token
          in <code>.env</code> ein, dann Pi neu starten. Bis dahin werden alle Posts mit 401
          abgewiesen.
        </div>
      )}

      <div className="flex gap-2 mb-3 overflow-x-auto pb-1">
        {(["all", "healthy", "info", "warning", "critical"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors whitespace-nowrap ${
              filter === s
                ? "bg-primary/15 text-primary border-primary/40"
                : "bg-transparent text-muted-foreground border-border"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {list.length === 0 ? (
        <EmptyState tokenConfigured={!!status.data?.tokenConfigured} components={components} />
      ) : (
        <ul className="space-y-2">
          {list.map((ev) => {
            const Icon = STATUS_ICON[ev.status] ?? Info;
            return (
              <li
                key={ev.id}
                className="rounded-xl border border-border bg-card/50 backdrop-blur-sm overflow-hidden"
              >
                <button
                  onClick={() => setOpen(open === ev.id ? null : ev.id)}
                  className="w-full text-left p-3 flex items-start gap-3"
                >
                  <div
                    className={`size-9 rounded-lg grid place-items-center border ${
                      STATUS_COLOR[ev.status] ?? STATUS_COLOR.info
                    }`}
                  >
                    <Icon className="size-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-semibold text-sm truncate">{ev.device}</span>
                      <span className="text-[10px] text-muted-foreground tabular-nums">
                        {new Date(ev.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {ev.component} · {fmtMetrics(ev.metrics)}
                    </div>
                    <div className="text-[10px] mt-1 flex items-center gap-1">
                      <ForwardBadge state={ev.forward} />
                    </div>
                  </div>
                </button>
                {open === ev.id && (
                  <pre className="mx-3 mb-3 p-2 text-[10px] bg-background/60 rounded-lg overflow-x-auto border border-border">
                    {JSON.stringify(ev, null, 2)}
                  </pre>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  accent = "text-foreground",
}: {
  icon: typeof Activity;
  label: string;
  value: number;
  accent?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card/50 p-3">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
        <Icon className="size-3" />
        {label}
      </div>
      <div className={`text-xl font-semibold tabular-nums ${accent}`}>{value}</div>
    </div>
  );
}

function ForwardBadge({ state }: { state: "pending" | "ok" | "skipped" | "failed" }) {
  const map: Record<string, string> = {
    ok: "text-emerald-300",
    pending: "text-amber-300",
    skipped: "text-muted-foreground",
    failed: "text-rose-300",
  };
  const label: Record<string, string> = {
    ok: "✓ cloud",
    pending: "↑ uploading",
    skipped: "· local only",
    failed: "✗ retry",
  };
  return <span className={map[state]}>{label[state]}</span>;
}

function EmptyState({
  tokenConfigured,
  components,
}: {
  tokenConfigured: boolean;
  components: string[];
}) {
  const sample = JSON.stringify(
    {
      component: "pump_monitor",
      device: "zisterne_drainpress",
      timestamp: new Date().toISOString(),
      status: "healthy",
      metrics: { watt: 395, voltage: 231, today_kwh: 0.45 },
    },
    null,
    2,
  );
  return (
    <div className="rounded-xl border border-dashed border-border p-4 text-xs text-muted-foreground space-y-3">
      <p>
        Noch keine Events. Konfigurier in Node-RED einen <strong>HTTP Request</strong> Node:
      </p>
      <pre className="bg-background/60 p-2 rounded-lg overflow-x-auto text-[10px] text-foreground border border-border">
        {`POST http://127.0.0.1:3000/api/public/ingest/event
Header  Authorization: Bearer \${PI_INGEST_TOKEN}
Body    ${sample}`}
      </pre>
      {tokenConfigured && (
        <p>
          Token testen vom Pi aus:{" "}
          <code className="text-foreground">
            curl -H "Authorization: Bearer $PI_INGEST_TOKEN" ...
          </code>
        </p>
      )}
      {components.length > 0 && <p>Bekannte Komponenten: {components.join(", ")}</p>}
    </div>
  );
}
