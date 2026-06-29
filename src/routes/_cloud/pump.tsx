import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { Droplets, Play, Pause, Power, Save, Cloud, Zap } from "lucide-react";
import { listDevices, enqueueCommand } from "@/lib/cloud.functions";
import {
  listDeviceEvents,
  listEventBuckets,
  getStrategy,
  upsertStrategy,
} from "@/lib/control.functions";

export const Route = createFileRoute("/_cloud/pump")({
  component: PumpPage,
});

function PumpPage() {
  const fetchDevices = useServerFn(listDevices);
  const fetchEvents = useServerFn(listDeviceEvents);
  const fetchBuckets = useServerFn(listEventBuckets);
  const fetchStrategy = useServerFn(getStrategy);
  const saveStrategy = useServerFn(upsertStrategy);
  const enqueue = useServerFn(enqueueCommand);
  const qc = useQueryClient();

  const { data: devices = [] } = useQuery({
    queryKey: ["devices"],
    queryFn: () => fetchDevices(),
  });

  const paired = devices.filter((d: any) => d.paired);
  const [deviceId, setDeviceId] = useState<string>("");
  const selected = useMemo(
    () => paired.find((d: any) => d.id === deviceId) ?? paired[0],
    [paired, deviceId],
  );
  const activeId = selected?.id;

  const { data: events = [] } = useQuery({
    queryKey: ["pump-events", activeId],
    queryFn: () => fetchEvents({ data: { deviceId: activeId, limit: 100 } }),
    refetchInterval: 10000,
    enabled: !!activeId,
  });

  const { data: buckets = [] } = useQuery({
    queryKey: ["pump-buckets", activeId],
    queryFn: () => fetchBuckets({ data: { deviceId: activeId } }),
    enabled: !!activeId,
  });

  const { data: strategy } = useQuery({
    queryKey: ["pump-strategy", activeId],
    queryFn: () => fetchStrategy({ data: { deviceId: activeId } }),
    enabled: !!activeId,
  });

  const params = (strategy?.params as any) ?? {};
  const [form, setForm] = useState<Record<string, any>>({});
  const merged = { ...params, ...form };
  const dirty = Object.keys(form).length > 0;

  const saveMut = useMutation({
    mutationFn: (vars: any) => saveStrategy({ data: { deviceId: activeId, ...vars } }),
    onSuccess: () => {
      setForm({});
      qc.invalidateQueries({ queryKey: ["pump-strategy", activeId] });
    },
  });

  const manualMut = useMutation({
    mutationFn: (vars: { action: "on" | "off"; minutes?: number }) =>
      enqueue({
        data: {
          deviceId: activeId,
          kind: "plugin_manual",
          payload: { id: "pump", runner: "nodered", action: vars.action, minutes: vars.minutes },
        },
      }),
  });

  const wattPoints = buckets
    .filter((r: any) => r.watts_avg != null)
    .slice(-48)
    .map((r: any) => ({
      t: new Date(r.bucket).toLocaleString(undefined, { day: "2-digit", hour: "2-digit" }),
      avg: Number(r.watts_avg),
      max: Number(r.watts_max),
    }));
  const maxW = wattPoints.length ? Math.max(...wattPoints.map((p) => p.max)) : 0;

  const pumpEvents = (events as any[]).filter((e) =>
    ["pump_control", "pump_guard", "eco_intelligence", "tibber_pulse", "weather_dwd"].includes(
      e.component,
    ),
  );
  const lastWattEvent = pumpEvents.find((e) => {
    const metrics = (e.metrics as any) ?? {};
    return metrics.watts != null || metrics.watt != null || metrics.house_power != null;
  });
  const lastWatts = (() => {
    const metrics = (lastWattEvent?.metrics as any) ?? {};
    return metrics.watts ?? metrics.watt ?? metrics.house_power;
  })();
  const lastDecision = pumpEvents[0] ?? events[0];

  const fields: Array<{ key: string; label: string; suffix?: string }> = [
    { key: "pv_min_w", label: "PV-Überschuss min", suffix: "W" },
    { key: "tibber_max_ct", label: "Tibber max", suffix: "ct/kWh" },
    { key: "heat_start_hour", label: "Hitze-Sperre ab", suffix: "h" },
    { key: "heat_end_hour", label: "Hitze-Sperre bis", suffix: "h" },
    { key: "run_minutes", label: "Laufzeit/Slot", suffix: "min" },
    { key: "max_minutes_per_day", label: "Tageslimit", suffix: "min" },
    { key: "rain_veto_mm", label: "Regen-Veto", suffix: "mm" },
  ];

  if (paired.length === 0) {
    return (
      <div className="px-5 space-y-3">
        <h2 className="text-xs uppercase tracking-widest text-muted-foreground">Pumpensteuerung</h2>
        <div className="rounded-2xl border border-dashed border-border p-8 text-center space-y-2">
          <Droplets size={32} className="mx-auto text-muted-foreground/40" />
          <p className="text-xs text-muted-foreground">Noch kein verbundener Pi.</p>
          <Link to="/devices" className="inline-block text-xs text-primary underline">
            Gerät verbinden →
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="px-5 space-y-5">
      <div>
        <h2 className="text-xs uppercase tracking-widest text-muted-foreground mb-1 flex items-center gap-1.5">
          <Droplets size={14} className="text-primary" /> Pumpensteuerung
        </h2>
        <p className="text-xs text-muted-foreground">
          Tibber + PV + Wetter → automatisch & manuell.
        </p>
      </div>

      {paired.length > 1 && (
        <select
          value={activeId}
          onChange={(e) => setDeviceId(e.target.value)}
          className="w-full rounded-lg bg-background border border-border px-3 py-2 font-mono text-sm"
        >
          {paired.map((d: any) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>
      )}

      {/* Live status card */}
      <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Live</div>
            <div className="text-2xl font-mono font-bold text-primary">
              {lastWatts != null ? `${Math.round(lastWatts)} W` : "—"}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Eco</div>
            <div className={`text-xs font-mono ${strategy?.eco_paused ? "text-amber-500" : "text-primary"}`}>
              {strategy?.eco_paused ? "PAUSIERT" : "AKTIV"}
            </div>
          </div>
        </div>
        {lastDecision && (
          <div className="text-[11px] text-muted-foreground font-mono border-t border-border pt-2">
            <span className="text-foreground">
              {new Date(lastDecision.occurred_at).toLocaleTimeString()}
            </span>{" "}
            — {lastDecision.message || lastDecision.strategy_applied || lastDecision.status}
          </div>
        )}
      </div>

      {/* Manual control */}
      <div className="space-y-2">
        <h3 className="text-[10px] uppercase tracking-widest text-muted-foreground px-1">
          Manuelle Steuerung
        </h3>
        <div className="grid grid-cols-3 gap-2">
          {[5, 10, 30].map((m) => (
            <button
              key={m}
              onClick={() => manualMut.mutate({ action: "on", minutes: m })}
              disabled={manualMut.isPending}
              className="rounded-xl border border-primary/30 bg-primary/5 text-primary py-3 text-xs uppercase tracking-widest flex flex-col items-center gap-1 active:scale-95 transition-transform"
            >
              <Play size={14} /> {m}m
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => manualMut.mutate({ action: "off" })}
            className="rounded-xl border border-border py-2.5 text-xs uppercase tracking-widest flex items-center justify-center gap-1"
          >
            <Power size={12} /> Stopp
          </button>
          <button
            onClick={() => saveMut.mutate({ ecoPaused: !strategy?.eco_paused })}
            className="rounded-xl border border-border py-2.5 text-xs uppercase tracking-widest flex items-center justify-center gap-1"
          >
            {strategy?.eco_paused ? <Play size={12} /> : <Pause size={12} />}
            Eco {strategy?.eco_paused ? "an" : "pausieren"}
          </button>
        </div>
      </div>

      {/* Watt history */}
      {wattPoints.length > 0 && (
        <div className="rounded-2xl border border-border bg-card p-4 space-y-2">
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground flex items-center gap-1">
            <Zap size={10} /> Watt-Verlauf · Skala bis {Math.round(maxW)} W
          </p>
          <div className="flex items-end gap-px h-24">
            {wattPoints.map((p, i) => (
              <div
                key={i}
                title={`${p.t}: ø ${Math.round(p.avg)}W / max ${Math.round(p.max)}W`}
                className="flex-1 bg-primary/40 hover:bg-primary transition-colors rounded-t"
                style={{ height: `${(p.avg / maxW) * 100}%`, minWidth: 3 }}
              />
            ))}
          </div>
        </div>
      )}

      {/* Strategy form */}
      <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
        <h3 className="text-[10px] uppercase tracking-widest text-muted-foreground flex items-center gap-1">
          <Cloud size={10} /> Strategie (Cloud → Pi & Node-RED)
        </h3>
        <div className="grid grid-cols-2 gap-2">
          {fields.map((f) => (
            <label
              key={f.key}
              className="text-[9px] uppercase tracking-widest text-muted-foreground"
            >
              {f.label} {f.suffix && `(${f.suffix})`}
              <input
                type="number"
                value={merged[f.key] ?? ""}
                onChange={(e) =>
                  setForm((s) => ({
                    ...s,
                    [f.key]: e.target.value === "" ? undefined : Number(e.target.value),
                  }))
                }
                className="mt-1 w-full rounded border border-border bg-background px-2 py-1 text-xs font-mono normal-case"
              />
            </label>
          ))}
        </div>
        <button
          disabled={!dirty || saveMut.isPending}
          onClick={() => saveMut.mutate({ params: { ...params, ...form } })}
          className="w-full rounded-lg bg-primary text-primary-foreground py-2 text-xs uppercase tracking-widest disabled:opacity-50 flex items-center justify-center gap-1"
        >
          <Save size={12} /> Speichern
        </button>
      </div>

      {/* Decisions timeline */}
      <div className="space-y-2">
        <h3 className="text-[10px] uppercase tracking-widest text-muted-foreground px-1">
          Letzte Entscheidungen
        </h3>
        <div className="rounded-2xl border border-border bg-card p-3 max-h-72 overflow-y-auto">
          {pumpEvents.length === 0 ? (
            <p className="text-[10px] text-muted-foreground text-center py-3">
              Noch keine Pumpen-Events. Node-RED meldet sie als pump_control, pump_guard,
              eco_intelligence, tibber_pulse oder weather_dwd.
            </p>
          ) : (
            <ul className="space-y-1">
              {pumpEvents.map((e: any) => (
                <li key={e.id} className="font-mono text-[10px] leading-tight">
                  <span className="text-muted-foreground">
                    {new Date(e.occurred_at).toLocaleTimeString()}{" "}
                  </span>
                  <span className={
                    e.status === "critical" ? "text-destructive" :
                    e.status === "warning" ? "text-amber-500" :
                    e.status === "info" ? "text-sky-500" : "text-primary"
                  }>[{e.status}]</span>
                  {e.strategy_applied && <span className="text-primary"> {e.strategy_applied}</span>}
                  {e.message && <span className="text-muted-foreground"> — {e.message}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
