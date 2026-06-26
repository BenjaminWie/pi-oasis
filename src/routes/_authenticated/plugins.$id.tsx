import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import {
  ArrowLeft,
  Play,
  Pause,
  RefreshCw,
  Power,
  PowerOff,
  Trash2,
  Sparkles,
  Settings as SettingsIcon,
} from "lucide-react";
import {
  getPlugin,
  runPlannerNow,
  manualAction,
  updatePlugin,
  deletePlugin,
} from "@/lib/plugins/plugins.functions";

export const Route = createFileRoute("/_authenticated/plugins/$id")({
  component: PluginDetailPage,
});

function PluginDetailPage() {
  const { id } = Route.useParams();
  const getFn = useServerFn(getPlugin);
  const plannerFn = useServerFn(runPlannerNow);
  const manualFn = useServerFn(manualAction);
  const updateFn = useServerFn(updatePlugin);
  const deleteFn = useServerFn(deletePlugin);
  const qc = useQueryClient();
  const nav = useNavigate();
  const [showConfig, setShowConfig] = useState(false);

  const q = useQuery({
    queryKey: ["plugin", id],
    queryFn: () => getFn({ data: { id } }),
    refetchInterval: 5000,
  });

  const planner = useMutation({
    mutationFn: () => plannerFn({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["plugin", id] }),
  });
  const manual = useMutation({
    mutationFn: (action: "on" | "off") => manualFn({ data: { id, action, minutes: 10 } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["plugin", id] }),
  });
  const toggle = useMutation({
    mutationFn: (enabled: boolean) => updateFn({ data: { id, enabled } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["plugin", id] }),
  });
  const del = useMutation({
    mutationFn: () => deleteFn({ data: { id } }),
    onSuccess: () => nav({ to: "/plugins" }),
  });

  if (q.isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  if (!q.data?.plugin)
    return (
      <div className="p-6">
        <p className="text-sm text-muted-foreground mb-3">Plugin not found.</p>
        <button onClick={() => nav({ to: "/plugins" })} className="text-primary text-sm">
          ← back
        </button>
      </div>
    );

  const { plugin, plan, decisions, simState } = q.data;
  const planActive = plan && new Date(plan.validUntil).getTime() > Date.now() ? plan : null;
  const nextWindow =
    planActive?.windows.find((w) => new Date(w.endIso).getTime() > Date.now()) ?? null;

  return (
    <div className="px-4 pt-6 pb-24">
      <button
        onClick={() => nav({ to: "/plugins" })}
        className="flex items-center gap-1 text-xs text-muted-foreground mb-3"
      >
        <ArrowLeft className="size-3" /> Plugins
      </button>

      <header className="mb-5">
        <div className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground mb-1">
          {plugin.kind} · {plugin.config.simulated ? "SIMULATED" : "LIVE MQTT"}
        </div>
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-xl font-bold">{plugin.name}</h1>
          <div className="flex gap-2">
            <button
              onClick={() => toggle.mutate(!plugin.enabled)}
              className={`size-9 rounded-xl grid place-items-center border ${
                plugin.enabled
                  ? "bg-status-ok/15 text-status-ok border-status-ok/40"
                  : "bg-muted text-muted-foreground border-border"
              }`}
              aria-label="enabled toggle"
            >
              {plugin.enabled ? <Power className="size-4" /> : <PowerOff className="size-4" />}
            </button>
            <button
              onClick={() => setShowConfig((s) => !s)}
              className="size-9 rounded-xl grid place-items-center bg-card border border-border text-muted-foreground"
              aria-label="config"
            >
              <SettingsIcon className="size-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Live status */}
      <section className="rounded-2xl bg-card border border-border p-4 mb-4">
        <div className="flex items-baseline justify-between mb-2">
          <span className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
            Current state
          </span>
          <span
            className={`text-xs font-mono font-bold ${
              simState?.on ? "text-status-ok" : "text-muted-foreground"
            }`}
          >
            {simState?.on ? "ON" : "OFF"}
          </span>
        </div>
        <div className="text-[11px] text-muted-foreground mb-3">
          {nextWindow
            ? `Next window: ${fmtTime(nextWindow.startIso)} → ${fmtTime(nextWindow.endIso)}`
            : planActive
              ? "No upcoming window today."
              : "No active plan."}
        </div>
        <div className="grid grid-cols-3 gap-2">
          <button
            onClick={() => manual.mutate("on")}
            disabled={manual.isPending || !plugin.enabled}
            className="flex flex-col items-center gap-1 py-2 rounded-xl bg-status-ok/15 text-status-ok text-[10px] font-mono uppercase tracking-widest disabled:opacity-40"
          >
            <Play className="size-4" /> Force ON
          </button>
          <button
            onClick={() => manual.mutate("off")}
            disabled={manual.isPending || !plugin.enabled}
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
      </section>

      {/* AI plan */}
      <section className="rounded-2xl bg-card border border-border p-4 mb-4">
        <div className="flex items-center gap-2 mb-2">
          <Sparkles className="size-3.5 text-primary" />
          <span className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
            AI Plan {planActive ? `(${planActive.source})` : ""}
          </span>
        </div>
        {planActive ? (
          <>
            <p className="text-sm">{planActive.rationale}</p>
            <div className="text-[11px] font-mono text-muted-foreground mt-2">
              valid until {fmtTime(planActive.validUntil)} · {planActive.windows.length} window(s)
              {planActive.abortIfRainMmNext6h != null
                ? ` · abort if rain ≥${planActive.abortIfRainMmNext6h}mm/6h`
                : ""}
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            No plan yet. Tap <span className="text-primary">Re-plan</span> to generate one.
          </p>
        )}
      </section>

      {/* Decision timeline */}
      <section>
        <div className="text-[10px] font-bold uppercase tracking-[0.3em] text-muted-foreground mb-2 px-1">
          Decision Timeline · {decisions.length}
        </div>
        <ul className="space-y-2">
          {decisions.length === 0 && (
            <li className="text-sm text-muted-foreground p-4 text-center bg-card rounded-2xl border border-border border-dashed">
              No decisions logged yet. The runner ticks every 60s.
            </li>
          )}
          {decisions.map((d) => (
            <li key={d.id} className="bg-card border border-border rounded-2xl px-3 py-2">
              <div className="flex items-baseline justify-between gap-2">
                <span
                  className={`text-[10px] font-mono font-bold uppercase tracking-widest ${actionColor(d.action)}`}
                >
                  {d.action.replace("_", " ")}
                </span>
                <span className="text-[10px] font-mono text-muted-foreground">
                  {fmtTime(d.decidedAt)}
                </span>
              </div>
              <p className="text-xs mt-1">{d.reason}</p>
              {d.inputs && (
                <details className="mt-1">
                  <summary className="text-[10px] text-muted-foreground cursor-pointer">
                    inputs
                  </summary>
                  <pre className="text-[10px] font-mono text-muted-foreground/80 mt-1 whitespace-pre-wrap">
                    {JSON.stringify(d.inputs, null, 2)}
                  </pre>
                </details>
              )}
            </li>
          ))}
        </ul>
      </section>

      {showConfig && (
        <section className="mt-6 rounded-2xl bg-card border border-border p-4 space-y-2">
          <div className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground mb-1">
            Config
          </div>
          <ConfigRow k="cmnd topic" v={plugin.config.cmndTopic} />
          <ConfigRow k="stat topic" v={plugin.config.statTopic} />
          <ConfigRow k="location" v={`${plugin.config.lat}, ${plugin.config.lon}`} />
          <ConfigRow k="run minutes" v={String(plugin.config.runMinutes)} />
          <ConfigRow k="max min/day" v={String(plugin.config.maxMinutesPerDay)} />
          <ConfigRow k="min h between" v={String(plugin.config.minHoursBetweenRuns)} />
          <ConfigRow k="simulated" v={plugin.config.simulated ? "yes" : "no"} />
          <button
            onClick={() => {
              if (confirm("Delete this plugin?")) del.mutate();
            }}
            className="mt-3 w-full flex items-center justify-center gap-2 py-2 rounded-xl bg-destructive/15 text-destructive text-[10px] font-mono uppercase tracking-widest"
          >
            <Trash2 className="size-3" /> Delete plugin
          </button>
        </section>
      )}
    </div>
  );
}

function ConfigRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between text-xs font-mono">
      <span className="text-muted-foreground">{k}</span>
      <span className="text-primary truncate ml-2">{v}</span>
    </div>
  );
}

function actionColor(a: string) {
  if (a === "on" || a === "manual_on") return "text-status-ok";
  if (a === "off" || a === "manual_off") return "text-status-warn";
  return "text-muted-foreground";
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleString([], {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}
