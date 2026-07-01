import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo, useEffect } from "react";
import { toast } from "sonner";
import { Droplets, Play, Pause, Power, Save, Cloud, Zap, Thermometer, CloudRain, Sun, Loader2, Info, AlertTriangle, RefreshCw } from "lucide-react";
import { listDevices, enqueueCommand, getDevice } from "@/lib/cloud.functions";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Area,
  ComposedChart,
} from "recharts";
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
  const fetchDeviceDetails = useServerFn(getDevice);
  const fetchEvents = useServerFn(listDeviceEvents);
  const fetchBuckets = useServerFn(listEventBuckets);
  const fetchStrategy = useServerFn(getStrategy);
  const saveStrategy = useServerFn(upsertStrategy);
  const enqueue = useServerFn(enqueueCommand);
  const qc = useQueryClient();

  const { data: devices = [] } = useQuery({
    queryKey: ["devices"],
    queryFn: () => fetchDevices(),
    refetchInterval: 30000,
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

  const { data: details } = useQuery({
    queryKey: ["device-details", activeId],
    queryFn: () => fetchDeviceDetails({ data: { id: activeId } }),
    enabled: !!activeId,
    refetchInterval: 5000,
  });

  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const [localAction, setLocalAction] = useState<{
    id?: string;
    action: "on" | "off";
    minutes?: number;
    expiresAt?: number;
  } | null>(null);

  const latestManual = details?.commands?.find((c: any) => c.kind === "plugin_manual");

  useEffect(() => {
    if (latestManual) {
      const mp: any = latestManual.payload;
      if (
        mp?.action === "off" &&
        (latestManual.status === "done" || latestManual.status === "delivered")
      ) {
        setLocalAction(null);
      }
      if (latestManual.id === localAction?.id && latestManual.status === "failed") {
        setLocalAction(null);
      }
    }
  }, [latestManual, localAction?.id]);

  const activeMinutes = useMemo(() => {
    if (localAction?.action === "on" && localAction.expiresAt && localAction.expiresAt > now) {
      return localAction.minutes;
    }
    const mp: any = latestManual?.payload;
    if (
      mp?.action === "on" &&
      (latestManual?.status === "done" || latestManual?.status === "delivered")
    ) {
      const mins = mp?.minutes || 10;
      const completedAt = latestManual?.completed_at || (latestManual as any)?.delivered_at || latestManual?.created_at;
      const startTime = new Date(completedAt).getTime();
      if (now < startTime + mins * 60 * 1000) {
        return mins;
      }
    }
    return null;
  }, [localAction, latestManual, now]);


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
    onSuccess: (data, vars) => {
      setLocalAction({
        id: data.id,
        action: vars.action,
        minutes: vars.minutes,
        expiresAt:
          vars.action === "on" ? Date.now() + (vars.minutes || 10) * 60 * 1000 : undefined,
      });
      toast.success(
        vars.action === "on"
          ? `Pumpe an${vars.minutes ? ` (${vars.minutes} min)` : ""} — wartet auf Node-RED`
          : "Stopp gesendet — wartet auf Node-RED",
      );
      qc.invalidateQueries({ queryKey: ["device-details", activeId] });
    },
    onError: (err: any) => {
      toast.error(`Befehl abgelehnt: ${err?.message || "unbekannter Fehler"}`);
    },
  });

  const testNoderedMut = useMutation({
    mutationFn: () =>
      enqueue({
        data: {
          deviceId: activeId,
          kind: "status",
          payload: { runner: "nodered" },
        },
      }),
    onSuccess: () => toast.success("Test an Node-RED gesendet — beobachte den Status unten"),
    onError: (err: any) => toast.error(`Test fehlgeschlagen: ${err?.message}`),
  });

  // Diagnose: is the latest plugin_manual stuck in "pending" for >30s?
  const pendingAgeMs = latestManual && latestManual.status === "pending"
    ? Date.now() - new Date(latestManual.created_at).getTime()
    : 0;
  const isStuck = pendingAgeMs > 30_000;
  const lastSeenMs = (details as any)?.device?.last_seen_at
    ? Date.now() - new Date((details as any).device.last_seen_at).getTime()
    : null;
  const isOffline = lastSeenMs != null && lastSeenMs > 5 * 60_000;


  const [visibleMetrics, setVisibleMetrics] = useState<Record<string, boolean>>({
    watts: true,
    temp: true,
    rain: true,
    pv: true,
    allowed: true,
  });

  const chartData = useMemo(() => {
    const grouped = buckets.reduce((acc: Record<string, any>, r: any) => {
      const bucketIso = new Date(r.bucket).toISOString();
      if (!acc[bucketIso]) {
        acc[bucketIso] = {
          t: new Date(r.bucket).toLocaleString(undefined, { day: "2-digit", hour: "2-digit" }),
          raw: bucketIso,
        };
      }
      const item = acc[bucketIso];
      if (r.watts_avg != null) item.watts = Number(r.watts_avg);
      if (r.temp_avg != null) item.temp = Number(r.temp_avg);
      if (r.rain_sum != null) item.rain = Number(r.rain_sum);
      if (r.pv_surplus_avg != null) item.pv = Number(r.pv_surplus_avg);
      if (r.pumping_allowed_ratio != null) item.allowed = Number(r.pumping_allowed_ratio) * 100;
      return acc;
    }, {});

    return Object.values(grouped)
      .sort((a: any, b: any) => a.raw.localeCompare(b.raw))
      .slice(-48);
  }, [buckets]);

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

  const latestMetric = (key: string) => {
    const ev = pumpEvents.find((e) => (e.metrics as any)?.[key] !== undefined);
    return (ev?.metrics as any)?.[key];
  };

  const curTemp = latestMetric("outside_temp");
  const curRain = latestMetric("precipitation_mm");
  const curPv = latestMetric("pv_surplus_watt");

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
          <div className="text-right flex flex-col items-end">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Eco</div>
            <div
              className={`text-xs font-mono px-2 py-0.5 rounded ${
                strategy?.eco_paused
                  ? "bg-amber-500/10 text-amber-500 border border-amber-500/20"
                  : "bg-primary/10 text-primary border border-primary/20"
              }`}
            >
              {strategy?.eco_paused ? "PAUSIERT" : "AKTIV"}
            </div>
          </div>
        </div>

        {(curTemp != null || curPv != null || curRain != null) && (
          <div className="grid grid-cols-3 gap-2 border-t border-border pt-3">
            {curPv != null && (
              <div className="space-y-0.5">
                <div className="text-[9px] uppercase text-muted-foreground flex items-center gap-1">
                  <Sun size={10} className="text-amber-500" /> PV
                </div>
                <div className="text-xs font-mono font-bold">{Math.round(curPv)} W</div>
              </div>
            )}
            {curTemp != null && (
              <div className="space-y-0.5">
                <div className="text-[9px] uppercase text-muted-foreground flex items-center gap-1">
                  <Thermometer size={10} className="text-rose-500" /> Temp
                </div>
                <div className="text-xs font-mono font-bold">{curTemp}°C</div>
              </div>
            )}
            {curRain != null && (
              <div className="space-y-0.5">
                <div className="text-[9px] uppercase text-muted-foreground flex items-center gap-1">
                  <CloudRain size={10} className="text-indigo-500" /> Regen
                </div>
                <div className="text-xs font-mono font-bold">{curRain} mm</div>
              </div>
            )}
          </div>
        )}

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
          {[5, 10, 30].map((m) => {
            const isActive = activeMinutes === m;
            const isPending =
              (manualMut.isPending && manualMut.variables?.minutes === m) ||
              (latestManual?.status === "pending" &&
                latestManual.id === localAction?.id &&
                localAction?.minutes === m);

            return (
              <button
                key={m}
                onClick={() => manualMut.mutate({ action: "on", minutes: m })}
                disabled={manualMut.isPending}
                className={`rounded-xl border py-3 text-xs uppercase tracking-widest flex flex-col items-center gap-1 active:scale-95 transition-all ${
                  isActive
                    ? "bg-green-500/20 border-green-500 text-green-500 shadow-[0_0_15px_rgba(34,197,94,0.2)]"
                    : isPending
                      ? "bg-amber-500/10 border-amber-500/50 text-amber-500"
                      : "border-primary/30 bg-primary/5 text-primary"
                }`}
              >
                {isPending ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Play size={14} className={isActive ? "fill-green-500/30" : ""} />
                )}
                {m}m
              </button>
            );
          })}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => manualMut.mutate({ action: "off" })}
            disabled={manualMut.isPending}
            className={`rounded-xl border py-2.5 text-xs uppercase tracking-widest flex items-center justify-center gap-1 transition-all ${
              (manualMut.isPending && manualMut.variables?.action === "off") ||
              (latestManual?.status === "pending" &&
                (latestManual.payload as any)?.action === "off" &&
                latestManual.id === localAction?.id)
                ? "bg-destructive/20 border-destructive text-destructive shadow-[0_0_15px_rgba(239,68,68,0.2)]"
                : "border-border"
            }`}
          >
            {manualMut.isPending && manualMut.variables?.action === "off" ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <Power size={12} />
            )}
            Stopp
          </button>
          <button
            onClick={() => saveMut.mutate({ ecoPaused: !strategy?.eco_paused })}
            className="rounded-xl border border-border py-2.5 text-xs uppercase tracking-widest flex items-center justify-center gap-1"
          >
            {strategy?.eco_paused ? <Play size={12} /> : <Pause size={12} />}
            Eco {strategy?.eco_paused ? "an" : "pausieren"}
          </button>
        </div>

        {/* Diagnostics strip */}
        {latestManual && (
          <div
            className={`rounded-xl border p-3 text-[11px] font-mono space-y-1 ${
              isStuck
                ? "border-amber-500/40 bg-amber-500/5 text-amber-500"
                : latestManual.status === "failed"
                  ? "border-destructive/40 bg-destructive/5 text-destructive"
                  : "border-border bg-background text-muted-foreground"
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span>
                Letzter Befehl: {(latestManual.payload as any)?.action?.toUpperCase() ?? "?"}
                {(latestManual.payload as any)?.minutes ? ` · ${(latestManual.payload as any).minutes}m` : ""}
                {" · "}
                <span className="uppercase">{latestManual.status}</span>
              </span>
              <span className="opacity-60">
                {Math.max(0, Math.round(pendingAgeMs / 1000))}s
              </span>
            </div>
            {isStuck && (
              <div className="flex items-start gap-1.5">
                <AlertTriangle size={11} className="mt-0.5 shrink-0" />
                <span>
                  Node-RED hat den Befehl nicht abgeholt. Prüfe Token & Poll-URL unter{" "}
                  <Link to="/integrations" className="underline">/integrations</Link>{" "}
                  auf dem Pi und ob der Flow deployt ist.
                </span>
              </div>
            )}
          </div>
        )}

        {isOffline && (
          <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 text-amber-500 p-3 text-[11px] font-mono flex items-start gap-1.5">
            <AlertTriangle size={11} className="mt-0.5 shrink-0" />
            <span>
              Pi ist seit {Math.round((lastSeenMs || 0) / 60000)} min offline. Befehle
              werden erst ausgeführt, wenn er wieder pollt.
            </span>
          </div>
        )}

        <button
          onClick={() => testNoderedMut.mutate()}
          disabled={testNoderedMut.isPending}
          className="w-full rounded-xl border border-dashed border-border py-2 text-[10px] uppercase tracking-widest text-muted-foreground flex items-center justify-center gap-1.5 hover:text-foreground hover:border-primary/40"
        >
          {testNoderedMut.isPending ? (
            <Loader2 size={11} className="animate-spin" />
          ) : (
            <RefreshCw size={11} />
          )}
          Test: Node-RED erreichbar?
        </button>
      </div>



      {/* History chart */}
      {chartData.length > 0 && (
        <div className="rounded-2xl border border-border bg-card p-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground flex items-center gap-1">
              <Zap size={10} /> Analyse-Historie (48h)
            </p>
            <div className="flex flex-wrap gap-1">
              {[
                { key: "watts", label: "Pumpe", color: "#0ea5e9", icon: Zap },
                { key: "pv", label: "PV", color: "#eab308", icon: Sun },
                { key: "temp", label: "Temp", color: "#f43f5e", icon: Thermometer },
                { key: "rain", label: "Regen", color: "#6366f1", icon: CloudRain },
                { key: "allowed", label: "Eco-Slot", color: "#22c55e", icon: Power },
              ].map((m) => (
                <button
                  key={m.key}
                  onClick={() => setVisibleMetrics((prev) => ({ ...prev, [m.key]: !prev[m.key] }))}
                  className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono transition-colors ${
                    visibleMetrics[m.key]
                      ? "bg-muted text-foreground border border-border"
                      : "opacity-30 grayscale border border-transparent"
                  }`}
                  style={{ color: visibleMetrics[m.key] ? m.color : undefined }}
                >
                  <m.icon size={10} /> {m.label}
                </button>
              ))}
            </div>
          </div>

          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: -20 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.05)" />
                <XAxis
                  dataKey="t"
                  fontSize={9}
                  tickLine={false}
                  axisLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis yAxisId="left" fontSize={9} tickLine={false} axisLine={false} />
                <YAxis yAxisId="right" orientation="right" fontSize={9} tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{ backgroundColor: "#171717", border: "1px solid #262626", fontSize: "10px", borderRadius: "8px" }}
                  itemStyle={{ padding: "0 2px" }}
                  formatter={(value: any, name: any) => {
                    const val = typeof value === 'number' ? value.toFixed(1) : value;
                    const label = String(name ?? "");
                    if (label.includes("(W)")) return [`${Math.round(value)} W`, label];
                    if (label.includes("(°C)")) return [`${val} °C`, label];
                    if (label.includes("(mm)")) return [`${val} mm`, label];
                    if (label.includes("%")) return [`${Math.round(value)}%`, label];
                    return [val, label];
                  }}
                />

                {visibleMetrics.allowed && (
                  <Area
                    yAxisId="right"
                    type="stepAfter"
                    dataKey="allowed"
                    stroke="none"
                    fill="#22c55e"
                    fillOpacity={0.05}
                    name="Eco Slot %"
                  />
                )}

                {visibleMetrics.pv && (
                  <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey="pv"
                    stroke="#eab308"
                    strokeWidth={1}
                    dot={false}
                    name="PV Überschuss (W)"
                  />
                )}

                {visibleMetrics.watts && (
                  <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey="watts"
                    stroke="#0ea5e9"
                    strokeWidth={2}
                    dot={false}
                    name="Pumpe (W)"
                  />
                )}

                {visibleMetrics.temp && (
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="temp"
                    stroke="#f43f5e"
                    strokeWidth={1}
                    strokeDasharray="4 4"
                    dot={false}
                    name="Temp (°C)"
                  />
                )}

                {visibleMetrics.rain && (
                  <Area
                    yAxisId="right"
                    type="monotone"
                    dataKey="rain"
                    stroke="#6366f1"
                    fill="#6366f1"
                    fillOpacity={0.2}
                    name="Regen (mm)"
                  />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Strategy form */}
      <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
        <h3 className="text-[10px] uppercase tracking-widest text-muted-foreground flex items-center gap-1">
          <Cloud size={10} /> Strategie (Cloud → Pi & Node-RED)
        </h3>
        {strategy?.eco_paused ? (
          <div className="py-8 text-center border border-dashed border-border rounded-xl bg-muted/20">
            <p className="text-[10px] text-muted-foreground italic px-6">
              Strategie ist pausiert. Die Werte sind ausgeblendet. Aktiviere "Eco", um Einstellungen zu sehen und anzupassen.
            </p>
          </div>
        ) : (
          <>
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
          </>
        )}
      </div>

      {/* Debug & Status */}
      <div className="px-1 flex items-center justify-between opacity-50 grayscale hover:grayscale-0 transition-all">
        <div className="flex items-center gap-1.5 text-[9px] font-mono text-muted-foreground">
          <Info size={10} />
          <span>ID: {activeId?.slice(0, 8)}...</span>
          <span>•</span>
          <span>
            POLL:{" "}
            {selected?.lastSeenAt ? new Date(selected.lastSeenAt).toLocaleTimeString() : "nie"}
          </span>
        </div>
        <div className="text-[9px] font-mono text-muted-foreground">
          {selected?.paired ? "RUNNER: ONLINE" : "RUNNER: OFFLINE"}
        </div>
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
