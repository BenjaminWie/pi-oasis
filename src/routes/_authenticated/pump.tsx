import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  Bug,
  Droplets,
  Gauge,
  Play,
  Pause,
  RefreshCw,
  Sun,
  Thermometer,
  Wifi,
  WifiOff,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { auth } from "@/lib/auth-store";
import { listPlugins, manualAction, runPlannerNow, getPlugin } from "@/lib/plugins.functions";
import {
  getLocalBuckets,
  getLocalPumpState,
  getLocalTraces,
} from "@/lib/local-telemetry.functions";

export const Route = createFileRoute("/_authenticated/pump")({
  head: () => ({
    meta: [
      { title: "Pumpensteuerung — Pi Hub lokal" },
      {
        name: "description",
        content:
          "Lokale Pumpensteuerung mit Live-Werten, 48-Stunden-Verlauf, Entscheidungen und Debug-Traces direkt auf dem Raspberry Pi.",
      },
      { property: "og:title", content: "Pumpensteuerung — Pi Hub lokal" },
      {
        property: "og:description",
        content: "Live-Werte, 48h-Verlauf und Debug-Traces der Pumpe direkt auf dem Pi.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: LocalPumpPage,
});

type Tick = Record<string, any>;

function useLocalStream(onTick: (t: Tick) => void, onTrace: (t: any) => void) {
  const [connected, setConnected] = useState(false);
  const tickRef = useRef(onTick);
  const traceRef = useRef(onTrace);
  tickRef.current = onTick;
  traceRef.current = onTrace;

  useEffect(() => {
    if (typeof window === "undefined") return;
    const token = auth.token;
    const es = new EventSource(`/api/live-stream${token ? `?t=${encodeURIComponent(token)}` : ""}`);
    es.addEventListener("hello", () => setConnected(true));
    es.addEventListener("ping", () => setConnected(true));
    es.addEventListener("tick", (e) => {
      try {
        tickRef.current(JSON.parse((e as MessageEvent).data));
      } catch {
        /* ignore */
      }
    });
    es.addEventListener("trace", (e) => {
      try {
        traceRef.current(JSON.parse((e as MessageEvent).data));
      } catch {
        /* ignore */
      }
    });
    es.onerror = () => setConnected(false);
    return () => es.close();
  }, []);

  return connected;
}

function LocalPumpPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(listPlugins);
  const stateFn = useServerFn(getLocalPumpState);
  const bucketFn = useServerFn(getLocalBuckets);
  const traceFn = useServerFn(getLocalTraces);
  const manualFn = useServerFn(manualAction);
  const plannerFn = useServerFn(runPlannerNow);
  const pluginFn = useServerFn(getPlugin);

  const [liveTick, setLiveTick] = useState<Tick | null>(null);
  const [liveTraces, setLiveTraces] = useState<any[]>([]);
  const [onlyErrors, setOnlyErrors] = useState(false);
  const [showDebug, setShowDebug] = useState(false);

  const connected = useLocalStream(
    (t) => setLiveTick(t),
    (t) => setLiveTraces((prev) => [t, ...prev].slice(0, 60)),
  );

  const plugins = useQuery({ queryKey: ["plugins"], queryFn: () => listFn(), staleTime: 60_000 });
  const pump = useMemo(
    () => plugins.data?.plugins.find((p) => p.kind === "smart_pump") ?? null,
    [plugins.data],
  );

  const state = useQuery({
    queryKey: ["local-pump-state"],
    queryFn: () => stateFn(),
    refetchInterval: connected ? false : 20_000,
  });
  const buckets = useQuery({
    queryKey: ["local-buckets"],
    queryFn: () => bucketFn({ data: { hours: 48 } }),
    refetchInterval: 5 * 60_000,
  });
  const traces = useQuery({
    queryKey: ["local-traces", onlyErrors],
    queryFn: () => traceFn({ data: { onlyErrors, limit: 60 } }),
    enabled: showDebug,
    refetchInterval: showDebug && !connected ? 30_000 : false,
  });
  const pluginDetail = useQuery({
    queryKey: ["plugin", pump?.id],
    queryFn: () => pluginFn({ data: { id: pump!.id } }),
    enabled: !!pump,
    refetchInterval: 30_000,
  });

  const manual = useMutation({
    mutationFn: (action: "on" | "off") =>
      manualFn({ data: { id: pump!.id, action, minutes: 10 } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["plugin", pump?.id] });
      qc.invalidateQueries({ queryKey: ["local-pump-state"] });
    },
  });
  const planner = useMutation({
    mutationFn: () => plannerFn({ data: { id: pump!.id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["plugin", pump?.id] }),
  });

  const tick: Tick = liveTick ?? (state.data?.lastTick as Tick) ?? {};
  const tickAgeMs = tick.ts ? Date.now() - new Date(tick.ts).getTime() : null;
  const simState = pluginDetail.data?.simState ?? null;
  const pumpOn = typeof tick.pump_on === "boolean" ? tick.pump_on : !!simState?.on;

  const chartData = (buckets.data?.buckets ?? []).map((b: any) => ({
    t: new Date(b.bucket).toLocaleString(undefined, { day: "2-digit", hour: "2-digit" }),
    watts: b.watts != null ? Math.round(b.watts) : undefined,
    temp: b.temp != null ? Math.round(b.temp * 10) / 10 : undefined,
    pv: b.pv != null ? Math.round(b.pv) : undefined,
    rain: b.rain,
    on: b.pump_on_ratio,
  }));

  const allTraces = [...liveTraces, ...((traces.data?.traces as any[]) ?? [])]
    .filter((t) => (onlyErrors ? t.ok === false : true))
    .slice(0, 60);

  return (
    <div className="px-4 pt-6 pb-28">
      <header className="mb-5">
        <div className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground mb-1 flex items-center gap-2">
          Local pump control
          {connected ? (
            <span className="inline-flex items-center gap-1 text-status-ok">
              <Wifi className="size-3" /> live
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <WifiOff className="size-3" /> polling
            </span>
          )}
        </div>
        <h1 className="text-xl font-bold">Pumpe</h1>
        <p className="text-[11px] text-muted-foreground mt-1">
          Alle Daten kommen direkt von Node-RED auf diesem Pi und liegen 48 h lokal.
        </p>
      </header>

      {/* Live tile */}
      <section className="rounded-2xl bg-card border border-border p-4 mb-4">
        <div className="flex items-baseline justify-between mb-3">
          <span className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
            Live
          </span>
          <span
            className={`text-xs font-mono font-bold ${pumpOn ? "text-status-ok" : "text-muted-foreground"}`}
          >
            {pumpOn ? "ON" : "OFF"}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Metric icon={Gauge} label="Watt" value={fmtNum(tick.watts)} unit="W" />
          <Metric icon={Sun} label="PV Überschuss" value={fmtNum(tick.pv_surplus_w)} unit="W" />
          <Metric
            icon={Thermometer}
            label="Außen"
            value={fmtNum(tick.outside_temp_c)}
            unit="°C"
          />
          <Metric icon={Droplets} label="Regen 24h" value={fmtNum(tick.rain_next_24h_mm)} unit="mm" />
        </div>
        <div className="text-[10px] font-mono text-muted-foreground mt-3">
          {tick.ts
            ? `letzter Tick vor ${fmtAge(tickAgeMs)}${tick.strategy_applied ? ` · ${tick.strategy_applied}` : ""}`
            : "noch kein Tick empfangen — sendet Node-RED an /api/public/ingest/live?"}
        </div>
      </section>

      {/* Controls */}
      <section className="rounded-2xl bg-card border border-border p-4 mb-4">
        <div className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground mb-3">
          Steuerung
        </div>
        {pump ? (
          <div className="grid grid-cols-3 gap-2">
            <button
              onClick={() => manual.mutate("on")}
              disabled={manual.isPending}
              className="flex flex-col items-center gap-1 py-2 rounded-xl bg-status-ok/15 text-status-ok text-[10px] font-mono uppercase tracking-widest disabled:opacity-40"
            >
              <Play className="size-4" /> Force ON
            </button>
            <button
              onClick={() => manual.mutate("off")}
              disabled={manual.isPending}
              className="flex flex-col items-center gap-1 py-2 rounded-xl bg-status-warn/15 text-status-warn text-[10px] font-mono uppercase tracking-widest disabled:opacity-40"
            >
              <Pause className="size-4" /> Force OFF
            </button>
            <button
              onClick={() => planner.mutate()}
              disabled={planner.isPending}
              className="flex flex-col items-center gap-1 py-2 rounded-xl bg-primary/15 text-primary text-[10px] font-mono uppercase tracking-widest disabled:opacity-40"
            >
              <RefreshCw className={`size-4 ${planner.isPending ? "animate-spin" : ""}`} /> Re-plan
            </button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Kein Smart-Pump-Plugin angelegt.{" "}
            <Link to="/plugins" className="text-primary">
              Jetzt anlegen →
            </Link>
          </p>
        )}
        {pump && (
          <Link
            to="/plugins/$id"
            params={{ id: pump.id }}
            className="block mt-3 text-[11px] text-primary"
          >
            Plugin-Details & Konfiguration →
          </Link>
        )}
      </section>

      {/* 48h chart */}
      <section className="rounded-2xl bg-card border border-border p-4 mb-4">
        <div className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground mb-3">
          Verlauf 48 h (lokal)
        </div>
        {chartData.length === 0 ? (
          <p className="text-sm text-muted-foreground">Noch keine lokalen Messwerte.</p>
        ) : (
          <div className="h-56 -ml-3">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                <XAxis dataKey="t" tick={{ fontSize: 9 }} minTickGap={24} />
                <YAxis tick={{ fontSize: 9 }} width={34} />
                <Tooltip
                  contentStyle={{
                    fontSize: 11,
                    background: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 12,
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                <Area
                  type="monotone"
                  dataKey="watts"
                  name="Watt"
                  stroke="hsl(var(--primary))"
                  fill="hsl(var(--primary))"
                  fillOpacity={0.15}
                />
                <Line type="monotone" dataKey="pv" name="PV" stroke="hsl(var(--status-ok))" dot={false} />
                <Line type="monotone" dataKey="temp" name="°C" stroke="hsl(var(--status-warn))" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      {/* Decisions */}
      <section className="rounded-2xl bg-card border border-border p-4 mb-4">
        <div className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground mb-3">
          Entscheidungen & Pump-Events
        </div>
        <ul className="space-y-2">
          {(pluginDetail.data?.decisions ?? []).slice(0, 15).map((d) => (
            <li key={d.id} className="border border-border rounded-xl px-3 py-2">
              <div className="flex justify-between items-baseline gap-2">
                <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-primary">
                  {d.action.replace("_", " ")}
                </span>
                <span className="text-[10px] font-mono text-muted-foreground">
                  {fmtTime(d.decidedAt)}
                </span>
              </div>
              <p className="text-xs mt-1">{d.reason}</p>
            </li>
          ))}
          {(state.data?.pumpEvents ?? []).slice(0, 15).map((e: any, i: number) => (
            <li key={`ev-${i}-${e.ts}`} className="border border-border/60 rounded-xl px-3 py-2">
              <div className="flex justify-between items-baseline gap-2">
                <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                  {e.component} · {e.status}
                </span>
                <span className="text-[10px] font-mono text-muted-foreground">{fmtTime(e.ts)}</span>
              </div>
              {e.message && <p className="text-xs mt-1">{e.message}</p>}
            </li>
          ))}
          {!pluginDetail.data?.decisions?.length && !state.data?.pumpEvents?.length && (
            <li className="text-sm text-muted-foreground">Noch nichts aufgezeichnet.</li>
          )}
        </ul>
      </section>

      {/* Debug */}
      <section className="rounded-2xl bg-card border border-border p-4">
        <button
          onClick={() => setShowDebug((s) => !s)}
          className="w-full flex items-center justify-between"
        >
          <span className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground inline-flex items-center gap-2">
            <Bug className="size-3.5" /> Debug / Traces
          </span>
          <span className="text-[10px] font-mono text-muted-foreground">
            {showDebug ? "ausblenden" : "anzeigen"}
          </span>
        </button>

        {showDebug && (
          <div className="mt-3 space-y-3">
            <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <input
                type="checkbox"
                checked={onlyErrors}
                onChange={(e) => setOnlyErrors(e.target.checked)}
              />
              nur Fehler
            </label>

            <div>
              <div className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground mb-2">
                Zuletzt gesehen
              </div>
              <ul className="space-y-1">
                {(state.data?.components ?? []).map((c: any) => (
                  <li
                    key={c.component}
                    className="flex justify-between text-[11px] font-mono text-muted-foreground"
                  >
                    <span className="text-foreground">{c.component}</span>
                    <span>
                      {c.count}× · {fmtTime(c.ts)}
                    </span>
                  </li>
                ))}
                {!state.data?.components?.length && (
                  <li className="text-[11px] text-muted-foreground">keine Events in 48 h</li>
                )}
              </ul>
            </div>

            <div>
              <div className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground mb-2">
                Requests
              </div>
              <ul className="space-y-2">
                {allTraces.map((t, i) => (
                  <li
                    key={`${t.rid ?? "x"}-${i}`}
                    className={`rounded-xl border px-3 py-2 ${
                      t.ok === false ? "border-destructive/50 bg-destructive/5" : "border-border"
                    }`}
                  >
                    <div className="flex justify-between gap-2 text-[10px] font-mono">
                      <span className="text-primary">{t.rid ?? "—"}</span>
                      <span className="text-muted-foreground">{fmtTime(t.ts)}</span>
                    </div>
                    <div className="text-[11px] font-mono mt-1">
                      {(t.target ?? "cloud").toUpperCase()} {t.route ?? ""} → {t.status ?? "—"}
                      {t.ms != null ? ` (${t.ms} ms)` : ""}
                    </div>
                    {t.reason && (
                      <div className="text-[11px] text-destructive mt-1">{t.reason}</div>
                    )}
                    {(t.body || t.response) && (
                      <details className="mt-1">
                        <summary className="text-[10px] text-muted-foreground cursor-pointer">
                          payload
                        </summary>
                        <pre className="text-[10px] font-mono text-muted-foreground/80 whitespace-pre-wrap break-all mt-1">
                          {String(t.body ?? "")}
                          {t.response ? `\n↳ ${String(t.response)}` : ""}
                        </pre>
                      </details>
                    )}
                  </li>
                ))}
                {allTraces.length === 0 && (
                  <li className="text-[11px] text-muted-foreground">
                    Keine Traces. Setze in Node-RED <code>LOCAL_SINK=on</code> und{" "}
                    <code>LOCAL_BASE_URL</code>.
                  </li>
                )}
              </ul>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
  unit,
}: {
  icon: any;
  label: string;
  value: string;
  unit: string;
}) {
  return (
    <div className="rounded-xl border border-border px-3 py-2">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-widest text-muted-foreground">
        <Icon className="size-3" /> {label}
      </div>
      <div className="text-lg font-mono font-bold">
        {value}
        <span className="text-[10px] text-muted-foreground ml-1">{unit}</span>
      </div>
    </div>
  );
}

function fmtNum(v: unknown) {
  const n = Number(v);
  return Number.isFinite(n) ? String(Math.round(n * 10) / 10) : "—";
}

function fmtAge(ms: number | null) {
  if (ms == null) return "—";
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 90) return `${s}s`;
  const m = Math.round(s / 60);
  return m < 90 ? `${m}m` : `${Math.round(m / 60)}h`;
}

function fmtTime(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
}

export { Activity };
