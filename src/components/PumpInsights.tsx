// Compact insight block reading from device_events_daily + device_events_hourly.
// Renders: today card, 7-day sparkline, week × hour heatmap, anomaly badge.
// No new libs — inline SVG grid + bars, matches existing minimal chart style.
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { Droplets, Sun, Zap, Activity } from "lucide-react";
import { listDailyRollup, listEventBuckets, listAnomalies } from "@/lib/control.functions";

type Daily = {
  day: string;
  pump_minutes: number;
  pump_cycles: number;
  pump_kwh: number;
  pv_covered_pct: number | null;
  rain_mm: number | null;
  avg_outside_temp: number | null;
  warnings: number;
  criticals: number;
};

export function PumpInsights({ deviceId }: { deviceId: string }) {
  const fetchDaily = useServerFn(listDailyRollup);
  const fetchHourly = useServerFn(listEventBuckets);
  const fetchAnomalies = useServerFn(listAnomalies);

  const { data: daily = [] } = useQuery({
    queryKey: ["daily-rollup", deviceId],
    queryFn: () => fetchDaily({ data: { deviceId, days: 30 } }),
    enabled: !!deviceId,
    staleTime: 5 * 60_000,
    refetchInterval: 15 * 60_000,
  });

  const { data: hourly = [] } = useQuery({
    queryKey: ["hourly-rollup", deviceId],
    queryFn: () => fetchHourly({ data: { deviceId } }),
    enabled: !!deviceId,
    staleTime: 5 * 60_000,
    refetchInterval: 15 * 60_000,
  });

  const { data: anomalies = [] } = useQuery({
    queryKey: ["anomalies", deviceId],
    queryFn: () => fetchAnomalies({ data: { deviceId } }),
    enabled: !!deviceId,
    staleTime: 30 * 60_000,
  });

  const today = daily[daily.length - 1] as Daily | undefined;
  const last7 = daily.slice(-7) as Daily[];
  const maxMin = Math.max(1, ...last7.map((d) => Number(d.pump_minutes || 0)));

  // Heatmap: 7 days × 24 hours, cell = pump minutes.
  // Sum pump_minutes across pump_control rows per (day-of-week, hour).
  const heat = useMemo(() => {
    const grid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
    for (const r of hourly as any[]) {
      if (r.component !== "pump_control" || !r.pump_minutes) continue;
      const d = new Date(r.bucket);
      const dow = (d.getDay() + 6) % 7; // Mon=0
      const h = d.getHours();
      grid[dow][h] += Number(r.pump_minutes);
    }
    const max = Math.max(1, ...grid.flat());
    return { grid, max };
  }, [hourly]);

  const wattsBaseline = anomalies.find((a: any) => a.metric === "watts") as any;
  const wattsToday = (() => {
    const todayIso = new Date().toISOString().slice(0, 10);
    const rows = (hourly as any[]).filter(
      (r) => r.component === "pump_control" && r.bucket.startsWith(todayIso) && r.watts_avg,
    );
    if (!rows.length) return null;
    return rows.reduce((s, r) => s + Number(r.watts_avg), 0) / rows.length;
  })();
  const anomaly =
    wattsBaseline && wattsToday && wattsBaseline.stddev > 0
      ? (wattsToday - Number(wattsBaseline.mean)) / Number(wattsBaseline.stddev)
      : null;

  const dowLabels = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

  return (
    <div className="space-y-4">
      {/* Today card */}
      <div className="grid grid-cols-4 gap-2">
        <Metric
          icon={Droplets}
          label="Heute"
          value={today ? `${Math.round(Number(today.pump_minutes))}` : "—"}
          unit="min"
        />
        <Metric
          icon={Activity}
          label="Zyklen"
          value={today ? String(today.pump_cycles) : "—"}
        />
        <Metric
          icon={Zap}
          label="kWh"
          value={today ? Number(today.pump_kwh).toFixed(2) : "—"}
        />
        <Metric
          icon={Sun}
          label="PV %"
          value={today?.pv_covered_pct != null ? String(Math.round(Number(today.pv_covered_pct))) : "—"}
        />
      </div>

      {anomaly != null && Math.abs(anomaly) > 2 && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-2 text-[10px] font-mono text-amber-500">
          Watt-Anomalie: heute {Math.round(wattsToday!)}W vs. Ø {Math.round(Number(wattsBaseline.mean))}W
          ({anomaly.toFixed(1)}σ)
        </div>
      )}

      {/* 7-day sparkline (pump minutes, colored by PV coverage) */}
      {last7.length > 0 && (
        <div className="space-y-1">
          <p className="text-[9px] uppercase tracking-widest text-muted-foreground">
            Letzte 7 Tage — Pumpenminuten (Farbe = PV-Anteil)
          </p>
          <div className="flex items-end gap-1.5 h-16">
            {last7.map((d) => {
              const mins = Number(d.pump_minutes || 0);
              const pct = d.pv_covered_pct != null ? Number(d.pv_covered_pct) : 0;
              const hue = 200 - (pct / 100) * 160; // 200=blue → 40=amber (more PV)
              return (
                <div key={d.day} className="flex-1 flex flex-col items-center gap-0.5">
                  <div
                    className="w-full rounded-t transition-all"
                    style={{
                      height: `${(mins / maxMin) * 100}%`,
                      minHeight: mins > 0 ? 2 : 1,
                      backgroundColor: mins > 0 ? `hsl(${hue} 70% 55%)` : "hsl(0 0% 20%)",
                    }}
                    title={`${d.day}: ${Math.round(mins)}min · ${Math.round(pct)}% PV · ${Number(d.pump_kwh).toFixed(2)}kWh`}
                  />
                  <span className="text-[8px] text-muted-foreground font-mono">
                    {new Date(d.day).toLocaleDateString(undefined, { weekday: "narrow" })}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Week × hour heatmap */}
      <div className="space-y-1">
        <p className="text-[9px] uppercase tracking-widest text-muted-foreground">
          Bewässerungs-Muster (Wochentag × Stunde)
        </p>
        <div className="grid grid-cols-[auto_1fr] gap-x-1 text-[8px] font-mono text-muted-foreground">
          <div className="flex flex-col justify-around py-0.5">
            {dowLabels.map((l) => (
              <div key={l} className="h-2.5 leading-none">{l}</div>
            ))}
          </div>
          <div className="grid grid-rows-7 gap-px">
            {heat.grid.map((row, dow) => (
              <div key={dow} className="grid grid-cols-24 gap-px" style={{ gridTemplateColumns: "repeat(24, 1fr)" }}>
                {row.map((v, h) => {
                  const intensity = v / heat.max;
                  return (
                    <div
                      key={h}
                      className="h-2.5 rounded-[1px]"
                      style={{
                        backgroundColor:
                          v === 0
                            ? "hsl(0 0% 12%)"
                            : `hsl(200 80% ${20 + intensity * 45}%)`,
                      }}
                      title={`${dowLabels[dow]} ${h}:00 — ${Math.round(v)}min`}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
        <div className="flex justify-between text-[8px] font-mono text-muted-foreground/60 pl-4">
          <span>00</span>
          <span>06</span>
          <span>12</span>
          <span>18</span>
          <span>23</span>
        </div>
      </div>
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
  unit?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-background/50 p-2">
      <div className="text-[9px] uppercase tracking-widest text-muted-foreground flex items-center gap-1">
        <Icon size={9} /> {label}
      </div>
      <div className="text-sm font-mono font-bold mt-0.5">
        {value}
        {unit && <span className="text-[9px] text-muted-foreground ml-0.5">{unit}</span>}
      </div>
    </div>
  );
}
