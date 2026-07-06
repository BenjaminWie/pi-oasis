import { useState, useEffect, useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Play, Pause, Power, Loader2, RefreshCw, AlertTriangle } from "lucide-react";
import { enqueueCommand } from "@/lib/cloud.functions";

interface ManualControlProps {
  activeId: string;
  latestManual: any;
  strategy: any;
  saveMut: any;
  details: any;
}

/**
 * ManualControl component isolates high-frequency UI updates (1s timer)
 * to prevent re-rendering the entire PumpPage and its expensive charts.
 */
export function ManualControl({
  activeId,
  latestManual,
  strategy,
  saveMut,
  details,
}: ManualControlProps) {
  const enqueue = useServerFn(enqueueCommand);
  const qc = useQueryClient();

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
      const completedAt =
        latestManual?.completed_at ||
        (latestManual as any)?.delivered_at ||
        latestManual?.created_at;
      const startTime = new Date(completedAt).getTime();
      if (now < startTime + mins * 60 * 1000) {
        return mins;
      }
    }
    return null;
  }, [localAction, latestManual, now]);

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
        expiresAt: vars.action === "on" ? Date.now() + (vars.minutes || 10) * 60 * 1000 : undefined,
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

  const pendingAgeMs =
    latestManual && latestManual.status === "pending"
      ? now - new Date(latestManual.created_at).getTime()
      : 0;
  const isStuck = pendingAgeMs > 30_000;
  const lastSeenMs = (details as any)?.device?.last_seen_at
    ? now - new Date((details as any).device.last_seen_at).getTime()
    : null;
  const isOffline = lastSeenMs != null && lastSeenMs > 5 * 60_000;

  return (
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
              {(latestManual.payload as any)?.minutes
                ? ` · ${(latestManual.payload as any).minutes}m`
                : ""}
              {" · "}
              <span className="uppercase">{latestManual.status}</span>
            </span>
            <span className="opacity-60">{Math.max(0, Math.round(pendingAgeMs / 1000))}s</span>
          </div>
          {isStuck && (
            <div className="flex items-start gap-1.5">
              <AlertTriangle size={11} className="mt-0.5 shrink-0" />
              <span>
                Node-RED hat den Befehl nicht abgeholt. Prüfe Token & Poll-URL unter{" "}
                <Link to="/integrations" className="underline">
                  /integrations
                </Link>{" "}
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
            Pi ist seit {Math.round((lastSeenMs || 0) / 60000)} min offline. Befehle werden erst
            ausgeführt, wenn er wieder pollt.
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
  );
}
