import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  listDeviceEvents,
  listEventBuckets,
  getStrategy,
  upsertStrategy,
  listAnomalies,
} from "@/lib/control.functions";
import { enqueueCommand } from "@/lib/cloud.functions";
import { Activity, BarChart3, Sliders, AlertTriangle, Pause, Play } from "lucide-react";

type Tab = "events" | "chart" | "strategy" | "anomalies";

export function DeviceAnalytics({ deviceId }: { deviceId: string }) {
  const [tab, setTab] = useState<Tab>("events");
  const tabs: Array<{ id: Tab; label: string; icon: any }> = [
    { id: "events", label: "Timeline", icon: Activity },
    { id: "chart", label: "Verlauf", icon: BarChart3 },
    { id: "strategy", label: "Strategie", icon: Sliders },
    { id: "anomalies", label: "Anomalien", icon: AlertTriangle },
  ];

  return (
    <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
      <div className="flex items-center gap-1 overflow-x-auto">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] uppercase tracking-widest border ${
              tab === t.id
                ? "border-primary text-primary bg-primary/5"
                : "border-border text-muted-foreground"
            }`}
          >
            <t.icon size={12} /> {t.label}
          </button>
        ))}
      </div>

      {tab === "events" && <EventsTab deviceId={deviceId} />}
      {tab === "chart" && <ChartTab deviceId={deviceId} />}
      {tab === "strategy" && <StrategyTab deviceId={deviceId} />}
      {tab === "anomalies" && <AnomaliesTab deviceId={deviceId} />}
    </div>
  );
}

function EventsTab({ deviceId }: { deviceId: string }) {
  const fn = useServerFn(listDeviceEvents);
  const { data = [] } = useQuery({
    queryKey: ["events", deviceId],
    queryFn: () => fn({ data: { deviceId, limit: 100 } }),
    refetchInterval: 30000,
    staleTime: 15000,
  });
  if (!data.length) {
    return <p className="text-xs text-muted-foreground">Noch keine Ereignisse.</p>;
  }
  return (
    <ul className="space-y-1.5 max-h-[420px] overflow-y-auto">
      {data.map((e: any) => {
        const color =
          e.status === "critical"
            ? "text-destructive"
            : e.status === "warning"
              ? "text-amber-500"
              : e.status === "info"
                ? "text-sky-500"
                : "text-primary";
        return (
          <li key={e.id} className="text-[11px] font-mono leading-tight">
            <span className="text-muted-foreground">
              {new Date(e.occurred_at).toLocaleTimeString()}{" "}
            </span>
            <span className={color}>[{e.status}]</span>{" "}
            <span className="text-foreground">{e.component}</span>
            {e.device_label && <span className="text-muted-foreground">/{e.device_label}</span>}
            {e.strategy_applied && (
              <span className="text-primary"> ⇒ {e.strategy_applied}</span>
            )}
            {e.message && <span className="text-muted-foreground"> — {e.message}</span>}
          </li>
        );
      })}
    </ul>
  );
}

function ChartTab({ deviceId }: { deviceId: string }) {
  const fn = useServerFn(listEventBuckets);
  const { data = [] } = useQuery({
    queryKey: ["buckets", deviceId],
    queryFn: () => fn({ data: { deviceId } }),
    refetchInterval: 300000,
    staleTime: 120000,
  });
  const wattPoints = data
    .filter((r: any) => r.watts_avg != null)
    .slice(-72)
    .map((r: any) => ({
      t: new Date(r.bucket).toLocaleString(undefined, { day: "2-digit", hour: "2-digit" }),
      avg: Number(r.watts_avg),
      max: Number(r.watts_max),
    }));
  if (!wattPoints.length) {
    return (
      <p className="text-xs text-muted-foreground">
        Noch keine aggregierten Daten. Nächtlicher Cron-Job verdichtet die Telemetrie.
      </p>
    );
  }
  const maxW = Math.max(...wattPoints.map((p) => p.max));
  return (
    <div className="space-y-2">
      <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
        Watt-Verlauf (stündlich, 7 Tage) — Skala bis {Math.round(maxW)} W
      </p>
      <div className="flex items-end gap-px h-32 border-b border-border">
        {wattPoints.map((p, i) => (
          <div
            key={i}
            title={`${p.t}: avg ${Math.round(p.avg)}W / max ${Math.round(p.max)}W`}
            className="flex-1 bg-primary/30 hover:bg-primary transition-colors"
            style={{ height: `${(p.avg / maxW) * 100}%`, minWidth: 2 }}
          />
        ))}
      </div>
    </div>
  );
}

function StrategyTab({ deviceId }: { deviceId: string }) {
  const getFn = useServerFn(getStrategy);
  const setFn = useServerFn(upsertStrategy);
  const sendCmd = useServerFn(enqueueCommand);
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["strategy", deviceId],
    queryFn: () => getFn({ data: { deviceId } }),
  });
  const mut = useMutation({
    mutationFn: (vars: any) => setFn({ data: { deviceId, ...vars } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["strategy", deviceId] }),
  });
  const overrideMut = useMutation({
    mutationFn: (minutes: number) =>
      sendCmd({
        data: { deviceId, kind: "terminal", payload: { command: `echo pump-override ${minutes}m` } },
      }),
  });

  const params = (data?.params as any) ?? {};
  const [form, setForm] = useState<Record<string, any>>({});
  const merged = { ...params, ...form };

  const fields: Array<{ key: string; label: string; suffix?: string }> = [
    { key: "pv_min_w", label: "PV-Überschuss min", suffix: "W" },
    { key: "tibber_max_ct", label: "Tibber max", suffix: "ct/kWh" },
    { key: "heat_start_hour", label: "Hitze-Sperre ab", suffix: "h" },
    { key: "heat_end_hour", label: "Hitze-Sperre bis", suffix: "h" },
    { key: "run_minutes", label: "Laufzeit pro Slot", suffix: "min" },
    { key: "max_minutes_per_day", label: "Tageslimit", suffix: "min" },
    { key: "rain_veto_mm", label: "Regen-Veto", suffix: "mm" },
  ];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between rounded-lg border border-border p-3">
        <div>
          <p className="text-xs font-medium">Eco-Automatik</p>
          <p className="text-[10px] text-muted-foreground">
            {data?.eco_paused ? "Pausiert — Node-RED lässt Pumpe aus." : "Aktiv"}
          </p>
        </div>
        <button
          onClick={() => mut.mutate({ ecoPaused: !data?.eco_paused })}
          className="flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-[11px] uppercase tracking-widest"
        >
          {data?.eco_paused ? <Play size={12} /> : <Pause size={12} />}
          {data?.eco_paused ? "Fortsetzen" : "Pausieren"}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {fields.map((f) => (
          <label key={f.key} className="text-[10px] uppercase tracking-widest text-muted-foreground">
            {f.label} {f.suffix && `(${f.suffix})`}
            <input
              type="number"
              value={merged[f.key] ?? ""}
              onChange={(e) =>
                setForm((s) => ({ ...s, [f.key]: e.target.value === "" ? undefined : Number(e.target.value) }))
              }
              className="mt-1 w-full rounded border border-border bg-background px-2 py-1 text-xs font-mono text-foreground normal-case"
            />
          </label>
        ))}
      </div>

      <button
        disabled={!Object.keys(form).length || mut.isPending}
        onClick={() => mut.mutate({ params: { ...params, ...form } })}
        className="w-full rounded-lg bg-primary text-primary-foreground py-2 text-xs uppercase tracking-widest disabled:opacity-50"
      >
        Strategie speichern
      </button>

      <div className="flex gap-2">
        {[5, 10, 30].map((m) => (
          <button
            key={m}
            onClick={() => overrideMut.mutate(m)}
            className="flex-1 rounded border border-border px-2 py-1.5 text-[10px] uppercase tracking-widest"
          >
            Pump {m}m
          </button>
        ))}
      </div>
    </div>
  );
}

function AnomaliesTab({ deviceId }: { deviceId: string }) {
  const fn = useServerFn(listAnomalies);
  const { data = [] } = useQuery({
    queryKey: ["anomalies", deviceId],
    queryFn: () => fn({ data: { deviceId } }),
  });
  if (!data.length) {
    return (
      <p className="text-xs text-muted-foreground">
        Keine Baseline. Stündlicher Cron-Job berechnet sie nach ~30 Mess-Events.
      </p>
    );
  }
  return (
    <ul className="space-y-2">
      {data.map((b: any) => (
        <li key={b.metric} className="rounded border border-border p-3 text-xs">
          <div className="flex justify-between font-mono">
            <span>{b.metric}</span>
            <span className="text-muted-foreground">
              n={b.sample_count} · {b.window_days}d
            </span>
          </div>
          <div className="mt-1 grid grid-cols-2 gap-2 text-[11px]">
            <span>
              μ <strong className="font-mono">{Number(b.mean).toFixed(1)}</strong>
            </span>
            <span>
              σ <strong className="font-mono">{Number(b.stddev).toFixed(2)}</strong>
            </span>
          </div>
          <p className="mt-1 text-[10px] text-muted-foreground">
            Aktualisiert {new Date(b.updated_at).toLocaleString()}
          </p>
        </li>
      ))}
    </ul>
  );
}
