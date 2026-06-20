import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getDevice,
  enqueueCommand,
  deleteDevice,
  regeneratePairing,
} from "@/lib/cloud.functions";
import { ArrowLeft, RefreshCw, Trash2, Play, Square, RotateCcw } from "lucide-react";

export const Route = createFileRoute("/_cloud/devices/$id")({
  component: DevicePage,
});

function DevicePage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
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
  const online =
    d.last_seen_at && Date.now() - new Date(d.last_seen_at).getTime() < 120_000;
  const paired = !!d.device_token_hash;

  return (
    <div className="px-5 space-y-4">
      <Link to="/cloud/devices" className="inline-flex items-center gap-1 text-xs text-muted-foreground">
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
          <h3 className="text-xs uppercase tracking-widest text-muted-foreground">
            Pairing-Code
          </h3>
          <div className="text-3xl font-mono font-bold text-primary tracking-widest text-center py-3">
            {d.pairing_code || "—"}
          </div>
          <p className="text-[10px] text-muted-foreground">
            Auf dem Pi ausführen:
          </p>
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
          <div className="rounded-2xl border border-border bg-card p-4">
            <h3 className="text-xs uppercase tracking-widest text-muted-foreground mb-3">
              Snapshot
            </h3>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <SnapRow label="CPU" value={snap.cpu != null ? Math.round(snap.cpu) + " %" : "—"} />
              <SnapRow label="RAM" value={snap.ram != null ? Math.round(snap.ram) + " %" : "—"} />
              <SnapRow label="Temp" value={snap.temp != null ? Math.round(snap.temp) + " °C" : "—"} />
              <SnapRow label="Disk" value={snap.disk != null ? Math.round(snap.disk) + " %" : "—"} />
            </div>
            <button
              onClick={() => cmd.mutate({ kind: "status" })}
              className="mt-4 w-full rounded-lg bg-primary text-primary-foreground py-2 text-xs uppercase tracking-widest flex items-center justify-center gap-1"
            >
              <RefreshCw size={12} /> Aktualisieren
            </button>
          </div>

          <div className="rounded-2xl border border-border bg-card p-4">
            <h3 className="text-xs uppercase tracking-widest text-muted-foreground mb-3">
              Container ({(snap.containers || []).length})
            </h3>
            <div className="space-y-2">
              {(snap.containers || []).map((c: any) => (
                <div key={c.name} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${c.status === "running" ? "bg-primary" : "bg-muted-foreground"}`}
                    />
                    <span className="font-mono">{c.name}</span>
                  </div>
                  <div className="flex gap-1">
                    <ActionBtn
                      icon={Play}
                      onClick={() =>
                        cmd.mutate({ kind: "container_action", payload: { name: c.name, action: "start" } })
                      }
                    />
                    <ActionBtn
                      icon={Square}
                      onClick={() =>
                        cmd.mutate({ kind: "container_action", payload: { name: c.name, action: "stop" } })
                      }
                    />
                    <ActionBtn
                      icon={RotateCcw}
                      onClick={() =>
                        cmd.mutate({ kind: "container_action", payload: { name: c.name, action: "restart" } })
                      }
                    />
                  </div>
                </div>
              ))}
              {(!snap.containers || snap.containers.length === 0) && (
                <p className="text-[10px] text-muted-foreground">Keine Daten</p>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-card p-4">
            <h3 className="text-xs uppercase tracking-widest text-muted-foreground mb-3">
              Befehls-Verlauf
            </h3>
            <div className="space-y-1 text-[11px] font-mono">
              {data.commands.map((c: any) => (
                <div key={c.id} className="flex justify-between gap-2 border-b border-border/40 py-1">
                  <span>{c.kind}</span>
                  <span
                    className={
                      c.status === "done"
                        ? "text-primary"
                        : c.status === "failed"
                          ? "text-destructive"
                          : "text-muted-foreground"
                    }
                  >
                    {c.status}
                  </span>
                </div>
              ))}
              {data.commands.length === 0 && (
                <p className="text-[10px] text-muted-foreground">Noch keine Befehle</p>
              )}
            </div>
          </div>
        </>
      )}

      <button
        onClick={async () => {
          if (!confirm("Gerät wirklich entfernen?")) return;
          await del({ data: { id } });
          navigate({ to: "/cloud/devices" });
        }}
        className="w-full rounded-lg border border-destructive/40 text-destructive py-2 text-xs uppercase tracking-widest flex items-center justify-center gap-1"
      >
        <Trash2 size={12} /> Entfernen
      </button>
    </div>
  );
}

function SnapRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between font-mono">
      <span className="text-muted-foreground text-[10px] uppercase tracking-widest">
        {label}
      </span>
      <span>{value}</span>
    </div>
  );
}

function ActionBtn({ icon: Icon, onClick }: any) {
  return (
    <button
      onClick={onClick}
      className="rounded border border-border px-2 py-1 hover:bg-muted"
    >
      <Icon size={11} />
    </button>
  );
}
