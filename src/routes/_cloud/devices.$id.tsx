import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { getDevice, enqueueCommand, deleteDevice, regeneratePairing } from "@/lib/cloud.functions";
import { ArrowLeft, RefreshCw, Trash2, Play, Square, RotateCcw, Terminal as TerminalIcon, Puzzle } from "lucide-react";
import { StatGauge } from "@/components/StatGauge";
import { DeviceAnalytics } from "@/components/DeviceAnalytics";

export const Route = createFileRoute("/_cloud/devices/$id")({
  component: DevicePage,
});

function DevicePage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const [terminalInput, setTerminalInput] = useState("");
  const fetchDevice = useServerFn(getDevice);
  const enqueue = useServerFn(enqueueCommand);
  const regen = useServerFn(regeneratePairing);
  const del = useServerFn(deleteDevice);
  const qc = useQueryClient();

  const { data } = useQuery({
    queryKey: ["device", id],
    queryFn: () => fetchDevice({ data: { id } }),
    refetchInterval: 3000,
    refetchIntervalInBackground: false,
  });

  const cmd = useMutation({
    mutationFn: (vars: { kind: any; payload?: any }) =>
      enqueue({ data: { deviceId: id, kind: vars.kind, payload: vars.payload ?? {} } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["device", id] }),
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
              <StatGauge
                label="CPU"
                value={snap.cpu != null ? `${Math.round(snap.cpu)}` : "—"}
                unit="%"
                pct={snap.cpu ?? 0}
                tone={snap.cpu > 75 ? "warn" : "ok"}
              />
              <StatGauge
                label="RAM"
                value={snap.ram != null ? `${Math.round(snap.ram)}` : "—"}
                unit="%"
                pct={snap.ram ?? 0}
                tone={snap.ram > 80 ? "warn" : "ok"}
              />
              <StatGauge
                label="TMP"
                value={snap.temp != null ? `${Math.round(snap.temp)}` : "—"}
                unit="°C"
                pct={snap.temp != null ? (snap.temp / 85) * 100 : 0}
                tone={snap.temp > 70 ? "crit" : "accent"}
              />
              <StatGauge
                label="Disk"
                value={snap.disk != null ? `${Math.round(snap.disk)}` : "—"}
                unit="%"
                pct={snap.disk ?? 0}
                tone={snap.disk > 90 ? "crit" : "ok"}
              />
            </div>
          </div>

          <div className="space-y-3">
            <h3 className="text-[10px] font-bold uppercase tracking-[0.3em] text-muted-foreground px-1">
              Container ({(snap.containers || []).length})
            </h3>
            <div className="grid gap-3">
              {(snap.containers || []).map((c: any) => (
                <div
                  key={c.name}
                  className="bg-card border border-border rounded-2xl p-4 relative overflow-hidden"
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <div
                        className={`size-2 rounded-full ${c.status === "running" ? "bg-status-ok glow-ok" : "bg-status-crit glow-crit"}`}
                      />
                      <span className="font-mono font-bold text-sm">{c.name}</span>
                    </div>
                    <div className="flex gap-1">
                      <ActionBtn
                        icon={Play}
                        onClick={() =>
                          cmd.mutate({
                            kind: "container_action",
                            payload: { name: c.name, action: "start" },
                          })
                        }
                      />
                      <ActionBtn
                        icon={Square}
                        onClick={() =>
                          cmd.mutate({
                            kind: "container_action",
                            payload: { name: c.name, action: "stop" },
                          })
                        }
                      />
                      <ActionBtn
                        icon={RotateCcw}
                        onClick={() =>
                          cmd.mutate({
                            kind: "container_action",
                            payload: { name: c.name, action: "restart" },
                          })
                        }
                      />
                    </div>
                  </div>
                  <div className="text-[10px] text-muted-foreground font-mono truncate mb-2">
                    {c.image}
                  </div>
                  <div className="flex gap-2">
                    <div className="py-1.5 px-2 bg-white/5 rounded-lg border border-border">
                      <span className="block text-[8px] uppercase text-muted-foreground font-bold">
                        Port
                      </span>
                      <span className="font-mono text-[10px] text-primary">
                        {c.ports?.[0] ?? "—"}
                      </span>
                    </div>
                    <div className="py-1.5 px-2 bg-white/5 rounded-lg border border-border">
                      <span className="block text-[8px] uppercase text-muted-foreground font-bold">
                        CPU / MEM
                      </span>
                      <span className="font-mono text-[10px]">
                        {c.cpu ?? 0}% · {c.mem ?? 0}M
                      </span>
                    </div>
                  </div>
                </div>
              ))}
              {(!snap.containers || snap.containers.length === 0) && (
                <p className="text-[10px] text-muted-foreground p-4 text-center border border-dashed border-border rounded-2xl">
                  Keine Daten
                </p>
              )}
            </div>
          </div>

          <div className="space-y-3">
            <h3 className="text-[10px] font-bold uppercase tracking-[0.3em] text-muted-foreground px-1">
              Plugins ({(snap.plugins || []).length})
            </h3>
            <div className="grid gap-3">
              {(snap.plugins || []).map((p: any) => (
                <div
                  key={p.id}
                  className="bg-card border border-border rounded-2xl p-4 relative overflow-hidden"
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Puzzle size={16} className="text-primary" />
                      <span className="font-mono font-bold text-sm">{p.name}</span>
                    </div>
                    <span className={`text-[10px] uppercase tracking-widest ${p.enabled ? "text-primary" : "text-muted-foreground"}`}>
                      {p.enabled ? "Enabled" : "Disabled"}
                    </span>
                  </div>
                  <div className="text-[10px] text-muted-foreground font-mono mb-3">
                    Type: {p.kind}
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => cmd.mutate({ kind: "plugin_run_planner", payload: { id: p.id } })}
                      className="flex-1 py-2 bg-primary/10 border border-primary/20 text-primary rounded-xl text-[10px] font-bold uppercase tracking-widest"
                    >
                      Plan rebuild
                    </button>
                    <button
                      onClick={() => cmd.mutate({ kind: "plugin_manual", payload: { id: p.id, action: "on", minutes: 10 } })}
                      className="flex-1 py-2 bg-status-ok/10 border border-status-ok/20 text-status-ok rounded-xl text-[10px] font-bold uppercase tracking-widest"
                    >
                      Manual ON (10m)
                    </button>
                  </div>
                </div>
              ))}
              {(!snap.plugins || snap.plugins.length === 0) && (
                <p className="text-[10px] text-muted-foreground p-4 text-center border border-dashed border-border rounded-2xl">
                  Keine Plugins konfiguriert
                </p>
              )}
            </div>
          </div>

          <div className="space-y-3">
            <h3 className="text-[10px] font-bold uppercase tracking-[0.3em] text-muted-foreground px-1">
              Terminal
            </h3>
            <div className="bg-card border border-border rounded-2xl p-4 space-y-3">
              <div className="flex gap-2">
                <input
                  value={terminalInput}
                  onChange={(e) => setTerminalInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && terminalInput) {
                      cmd.mutate({ kind: "terminal", payload: { cmd: terminalInput } });
                      setTerminalInput("");
                    }
                  }}
                  placeholder="Befehl (z.B. uptime, docker ps)"
                  className="flex-1 bg-background border border-border rounded-lg px-3 py-2 text-xs font-mono"
                />
                <button
                  onClick={() => {
                    if (terminalInput) {
                      cmd.mutate({ kind: "terminal", payload: { cmd: terminalInput } });
                      setTerminalInput("");
                    }
                  }}
                  disabled={!terminalInput || cmd.isPending}
                  className="bg-primary text-primary-foreground p-2 rounded-lg disabled:opacity-50"
                >
                  <TerminalIcon size={16} />
                </button>
              </div>

              <div className="space-y-2 max-h-60 overflow-y-auto font-mono text-[11px]">
                {data.commands
                  .filter((c: any) => c.kind === "terminal" || c.kind === "status")
                  .map((c: any) => (
                    <div key={c.id} className="border-b border-border/40 pb-2 last:border-0">
                      <div className="flex justify-between text-[9px] text-muted-foreground mb-1">
                        <span>{c.kind === "terminal" ? `$ ${c.payload.cmd}` : "Status Update"}</span>
                        <span>{new Date(c.created_at).toLocaleTimeString()}</span>
                      </div>
                      {c.status === "pending" && <div className="text-muted-foreground animate-pulse">Running...</div>}
                      {c.status === "failed" && <div className="text-destructive">Failed: {c.result?.error || "Unknown error"}</div>}
                      {c.status === "done" && (
                        <pre className="whitespace-pre-wrap break-all text-foreground/90">
                          {c.kind === "terminal" ? c.result?.output : "Snapshot updated"}
                        </pre>
                      )}
                    </div>
                  ))}
                {data.commands.length === 0 && (
                  <p className="text-[10px] text-muted-foreground text-center py-4">Noch keine Befehle</p>
                )}
              </div>
            </div>
          </div>
        </>
      )}

      {paired && <DeviceAnalytics deviceId={id} />}



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
