import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, Play, Square, RotateCcw, TerminalSquare } from "lucide-react";
import { getContainer, containerAction } from "@/lib/system.functions";

export const Route = createFileRoute("/_authenticated/container/$id")({
  component: ContainerDetail,
});

function ContainerDetail() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const getFn = useServerFn(getContainer);
  const actFn = useServerFn(containerAction);

  const q = useQuery({
    queryKey: ["container", id],
    queryFn: () => getFn({ data: { id } }),
    refetchInterval: 3000,
  });

  const m = useMutation({
    mutationFn: (action: "start" | "stop" | "restart") =>
      actFn({ data: { id, action } }),
    onSuccess: () => q.refetch(),
  });

  const c = q.data;
  if (!q.isLoading && !c) {
    return (
      <div className="px-6 pt-10 text-center">
        <p className="text-sm text-muted-foreground">Container not found.</p>
        <Link to="/overview" className="text-primary font-mono text-xs mt-4 inline-block">
          ← back
        </Link>
      </div>
    );
  }

  const failing = c?.status === "exited";

  return (
    <div className="px-4 pt-6">
      <button
        onClick={() => navigate({ to: "/overview" })}
        className="flex items-center gap-2 text-xs text-muted-foreground mb-5 uppercase tracking-widest"
      >
        <ArrowLeft className="size-4" /> Hub
      </button>

      {c && (
        <>
          <header className="mb-6">
            <div className="text-[10px] text-primary font-mono mb-1 tracking-widest opacity-60">
              CONTAINER_ID: {c.id}
            </div>
            <h1 className={`font-mono font-bold text-2xl ${failing ? "text-status-crit" : ""}`}>
              {c.name}
            </h1>
            <p className="text-[10px] text-muted-foreground/70 font-mono mt-1">{c.image}</p>
          </header>

          <section className="grid grid-cols-3 gap-2 mb-6">
            <Pill label="Port" value={c.ports.join(",")} />
            <Pill label="Net" value={c.network} />
            <Pill label="Up" value={c.uptime} />
          </section>

          {/* Logs */}
          <div className="bg-black/80 p-4 font-mono text-[10px] text-status-ok/70 h-56 overflow-auto mb-4 rounded-2xl border border-border relative">
            {c.logs.map((l, i) => (
              <div key={i} className={i === c.logs.length - 1 ? "text-white/90" : "opacity-60"}>
                {l}
              </div>
            ))}
            <div className="animate-pulse text-primary mt-1">_</div>
          </div>

          <div className="grid grid-cols-3 gap-2 mb-6">
            <ActionBtn
              icon={<Play className="size-3.5" />}
              label="Start"
              onClick={() => m.mutate("start")}
              disabled={!failing || m.isPending}
            />
            <ActionBtn
              icon={<Square className="size-3.5" />}
              label="Stop"
              onClick={() => m.mutate("stop")}
              disabled={failing || m.isPending}
            />
            <ActionBtn
              icon={<RotateCcw className="size-3.5" />}
              label="Restart"
              tone="warn"
              onClick={() => m.mutate("restart")}
              disabled={m.isPending}
            />
          </div>

          <Link
            to="/terminal"
            className="flex items-center justify-center gap-2 py-3.5 bg-primary/10 border border-primary/30 rounded-2xl text-xs font-bold uppercase tracking-widest text-primary glow-accent"
          >
            <TerminalSquare className="size-4" />
            Open shell
          </Link>
        </>
      )}
    </div>
  );
}

function Pill({ label, value }: { label: string; value: string }) {
  return (
    <div className="py-2.5 px-3 bg-white/5 rounded-2xl border border-border">
      <span className="block text-[9px] uppercase text-muted-foreground font-bold mb-0.5">
        {label}
      </span>
      <span className="font-mono text-sm text-primary truncate block">{value}</span>
    </div>
  );
}

function ActionBtn({
  icon,
  label,
  onClick,
  disabled,
  tone = "default",
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: "default" | "warn";
}) {
  const cls =
    tone === "warn"
      ? "bg-status-warn/10 border-status-warn/30 text-status-warn"
      : "bg-white/5 border-border";
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center justify-center gap-1.5 py-3 border rounded-2xl text-[10px] font-bold uppercase tracking-widest disabled:opacity-30 disabled:cursor-not-allowed active:scale-95 transition-transform ${cls}`}
    >
      {icon}
      {label}
    </button>
  );
}
