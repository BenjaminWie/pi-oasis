import { Link } from "@tanstack/react-router";
import type { ContainerSummary } from "@/lib/mock-data";

const statusMeta = {
  running: { dot: "bg-status-ok glow-ok", label: "RUNNING", text: "text-foreground" },
  warning: { dot: "bg-status-warn glow-warn animate-pulse", label: "DEGRADED", text: "text-foreground" },
  restarting: { dot: "bg-status-warn glow-warn animate-pulse", label: "RESTARTING", text: "text-foreground" },
  exited: { dot: "bg-status-crit glow-crit animate-pulse", label: "EXITED", text: "text-status-crit" },
} as const;

export function ContainerCard({ c }: { c: ContainerSummary }) {
  const meta = statusMeta[c.status];
  const isFailing = c.status === "exited";

  return (
    <Link
      to="/container/$id"
      params={{ id: c.id }}
      className={`block bg-card border rounded-3xl p-5 relative overflow-hidden shadow-xl active:scale-[0.98] transition-transform ${
        isFailing ? "border-status-crit/30" : "border-border"
      }`}
    >
      <div className="absolute top-5 right-5 flex items-center gap-2">
        {c.isMqtt && (
          <span className="text-[8px] font-bold uppercase tracking-widest text-primary bg-primary/15 border border-primary/30 rounded-md px-1.5 py-0.5">
            MQTT
          </span>
        )}
        <div className={`size-2 rounded-full ${meta.dot}`} />
      </div>
      <div className="mb-4 pr-6">
        <div className="text-[10px] text-primary font-mono mb-1 tracking-widest opacity-60">
          {isFailing ? `STATE: EXITED_WITH_ERROR` : `CONTAINER_ID: ${c.id}`}
        </div>
        <h3 className={`font-mono font-bold text-lg tracking-tight ${meta.text}`}>
          {c.name}
        </h3>
        <p className="text-[10px] text-muted-foreground/70 font-mono mt-1 truncate">
          {c.image}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="py-2.5 px-3 bg-white/5 rounded-2xl border border-border">
          <span className="block text-[9px] uppercase text-muted-foreground font-bold mb-0.5">
            Port
          </span>
          <span className="font-mono text-sm text-primary">{c.ports[0] ?? "—"}</span>
        </div>
        <div className="py-2.5 px-3 bg-white/5 rounded-2xl border border-border">
          <span className="block text-[9px] uppercase text-muted-foreground font-bold mb-0.5">
            CPU / MEM
          </span>
          <span className="font-mono text-sm">
            {c.cpu}% · {c.mem}M
          </span>
        </div>
      </div>
    </Link>
  );
}
