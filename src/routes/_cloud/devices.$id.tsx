import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getDevice, enqueueCommand, deleteDevice, regeneratePairing } from "@/lib/cloud.functions";
import { listDeviceEvents } from "@/lib/control.functions";
import { ArrowLeft, RefreshCw, Trash2, Play, Square, RotateCcw, Power } from "lucide-react";
import { StatGauge } from "@/components/StatGauge";
import { DeviceAnalytics } from "@/components/DeviceAnalytics";

export const Route = createFileRoute("/_cloud/devices/$id")({
  component: DevicePage,
});

function DevicePage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const fetchDevice = useServerFn(getDevice);
  const fetchEvents = useServerFn(listDeviceEvents);
  const enqueue = useServerFn(enqueueCommand);
  const regen = useServerFn(regeneratePairing);
  const del = useServerFn(deleteDevice);
  const qc = useQueryClient();

  const { data } = useQuery({
    queryKey: ["device", id],
    queryFn: () => fetchDevice({ data: { id } }),
    refetchInterval: 5000,
    refetchIntervalInBackground: false,
  });

  const { data: events = [] } = useQuery({
    queryKey: ["device-events-mini", id],
    queryFn: () => fetchEvents({ data: { deviceId: id, limit: 20 } }),
    refetchInterval: 8000,
    refetchIntervalInBackground: false,
    enabled: !!data?.device?.device_token_hash,
  });

  const cmd = useMutation({
    mutationFn: (vars: { kind: any; payload?: any }) =>
      enqueue({ data: { deviceId: id, kind: vars.kind, payload: vars.payload ?? {} } }),
    onSuccess: () => {
      // Refetch device shortly after a command so the snapshot reflects the change.
      setTimeout(() => qc.invalidateQueries({ queryKey: ["device", id] }), 1200);
    },
  });

  if (!data) return <div className="px-5 text-xs text-muted-foreground">Lade...</div>;

  const d = data.device;
  const snap = (d.last_snapshot as any) || {};
  const online = d.last_seen_at && Date.now() - new Date(d.last_seen_at).getTime() < 120_000;
  const paired = !!d.device_token_hash;

  return (
    <div className="px-5 space-y-4">
      <Link to="/devices" className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <ArrowLeft size={14} /> zurück
      </Link>

      <div className="rounded-2xl border border-border bg-card p-4">
        <div className="flex items-center justify-between">
          <h2 className="font-mono font-bold text-lg">{d.name}</h2>
          <span
            className={`text-[10px] uppercase tracking-widest ${online ? "text-primary" : "text-muted-foreground"}`}
          >
            {paired ? (online ? "Online" : "Offline") : "Unpaired"}
          </span>
        </div>
        {d.last_seen_at && (
          <p className="text-[10px] text-muted-foreground mt-1">
            Letzter Heartbeat: {new Date(d.last_seen_at).toLocaleString()}
          </p>
        )}
      </div>

      {!paired ? (
        <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
          <h3 className="text-xs uppercase tracking-widest text-muted-foreground">Pairing-Code</h3>
          <div className="text-3xl font-mono font-bold text-primary tracking-widest text-center py-3">
            {d.pairing_code || "—"}
          </div>
          <p className="text-[10px] text-muted-foreground">Auf dem Pi ausführen:</p>
          <pre className="text-[10px] bg-background border border-border rounded p-2 overflow-x-auto font-mono">
            {`pi-agent register \\
  --url ${typeof window !== "undefined" ? window.location.origin : "https://..."} \\
  --code ${d.pairing_code}`}
          </pre>
          <button
            onClick={async () => {
              await regen({ data: { id } });
              qc.invalidateQueries({ queryKey: ["device", id] });
            }}
            className="w-full rounded-lg border border-border py-2 text-xs uppercase tracking-widest"
          >
            Neuen Code erzeugen
          </button>
        </div>
      ) : (
        <>
          <div className="space-y-3">
            <div className="flex items-center justify-between px-1">
              <h3 className="text-[10px] font-bold uppercase tracking-[0.3em] text-muted-foreground">
                Snapshot
              </h3>
              <button
                onClick={() => cmd.mutate({ kind: "status" })}
                className="text-primary p-1 active:scale-90 transition-transform"
                title="Aktualisieren"
              >
                <RefreshCw size={14} className={cmd.isPending ? "animate-spin" : ""} />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <StatGauge label="CPU" value={snap.cpu != null ? `${Math.round(snap.cpu)}` : "—"} unit="%" pct={snap.cpu ?? 0} tone={snap.cpu > 75 ? "warn" : "ok"} />
              <StatGauge label="RAM" value={snap.ram != null ? `${Math.round(snap.ram)}` : "—"} unit="%" pct={snap.ram ?? 0} tone={snap.ram > 80 ? "warn" : "ok"} />
              <StatGauge label="TMP" value={snap.temp != null ? `${Math.round(snap.temp)}` : "—"} unit="°C" pct={snap.temp != null ? (snap.temp / 85) * 100 : 0} tone={snap.temp > 70 ? "crit" : "accent"} />
              <StatGauge label="Disk" value={snap.disk != null ? `${Math.round(snap.disk)}` : "—"} unit="%" pct={snap.disk ?? 0} tone={snap.disk > 90 ? "crit" : "ok"} />
            </div>
          </div>

          <div className="space-y-3">
            <h3 className="text-[10px] font-bold uppercase tracking-[0.3em] text-muted-foreground px-1">
              Container ({(snap.containers || []).length})
            </h3>
            <div className="grid gap-3">
              {(snap.containers || []).map((c: any) => (
                <div key={c.name} className="bg-card border border-border rounded-2xl p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <div className={`size-2 rounded-full ${c.status === "running" ? "bg-status-ok glow-ok" : "bg-status-crit glow-crit"}`} />
                      <span className="font-mono font-bold text-sm">{c.name}</span>
                    </div>
                    <div className="flex gap-1">
                      <ActionBtn icon={Play} onClick={() => cmd.mutate({ kind: "container_action", payload: { name: c.name, action: "start" } })} />
                      <ActionBtn icon={Square} onClick={() => cmd.mutate({ kind: "container_action", payload: { name: c.name, action: "stop" } })} />
                      <ActionBtn icon={RotateCcw} onClick={() => cmd.mutate({ kind: "container_action", payload: { name: c.name, action: "restart" } })} />
                    </div>
                  </div>
                  <div className="text-[10px] text-muted-foreground font-mono truncate mb-2">{c.image}</div>
                  <div className="flex gap-2">
                    <div className="py-1.5 px-2 bg-white/5 rounded-lg border border-border">
                      <span className="block text-[8px] uppercase text-muted-foreground font-bold">Port</span>
                      <span className="font-mono text-[10px] text-primary">{c.ports?.[0] ?? "—"}</span>
                    </div>
                    <div className="py-1.5 px-2 bg-white/5 rounded-lg border border-border">
                      <span className="block text-[8px] uppercase text-muted-foreground font-bold">CPU / MEM</span>
                      <span className="font-mono text-[10px]">{c.cpu ?? 0}% · {c.mem ?? 0}M</span>
                    </div>
                  </div>
                </div>
              ))}
              {(!snap.containers || snap.containers.length === 0) && (
                <p className="text-[10px] text-muted-foreground p-4 text-center border border-dashed border-border rounded-2xl">
                  Keine Container im Snapshot
                </p>
              )}
            </div>
          </div>

          <div className="space-y-3">
            <h3 className="text-[10px] font-bold uppercase tracking-[0.3em] text-muted-foreground px-1">
              Live-Ereignisse
            </h3>
            <div className="bg-card border border-border rounded-2xl p-3 max-h-60 overflow-y-auto">
              {events.length === 0 ? (
                <p className="text-[10px] text-muted-foreground text-center py-2">
                  Noch keine Ereignisse aus Node-RED / Plugins.
                </p>
              ) : (
                <ul className="space-y-1">
                  {events.map((e: any) => (
                    <li key={e.id} className="font-mono text-[10px] leading-tight">
                      <span className="text-muted-foreground">{new Date(e.occurred_at).toLocaleTimeString()} </span>
                      <span className={
                        e.status === "critical" ? "text-destructive" :
                        e.status === "warning" ? "text-amber-500" :
                        e.status === "info" ? "text-sky-500" : "text-primary"
                      }>[{e.status}]</span>{" "}
                      <span>{e.component}</span>
                      {e.message && <span className="text-muted-foreground"> — {e.message}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <DeviceAnalytics deviceId={id} />

          <button
            onClick={() => {
              if (!confirm("Pi jetzt neu starten? Wird ~30s offline gehen.")) return;
              cmd.mutate({ kind: "system_reboot" });
            }}
            className="w-full rounded-lg border border-amber-500/40 text-amber-500 py-2 text-xs uppercase tracking-widest flex items-center justify-center gap-1"
          >
            <Power size={12} /> Pi neu starten
          </button>
        </>
      )}

      <button
        onClick={async () => {
          if (!confirm("Gerät wirklich entfernen?")) return;
          await del({ data: { id } });
          navigate({ to: "/devices" });
        }}
        className="w-full rounded-lg border border-destructive/40 text-destructive py-2 text-xs uppercase tracking-widest flex items-center justify-center gap-1"
      >
        <Trash2 size={12} /> Entfernen
      </button>
    </div>
  );
}

function ActionBtn({ icon: Icon, onClick }: any) {
  return (
    <button onClick={onClick} className="rounded border border-border px-2 py-1 hover:bg-muted">
      <Icon size={11} />
    </button>
  );
}
