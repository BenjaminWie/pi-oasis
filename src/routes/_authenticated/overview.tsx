import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getSystemStats, listContainers } from "@/lib/system/system.functions";
import { StatGauge } from "@/components/StatGauge";
import { ContainerCard } from "@/components/ContainerCard";

export const Route = createFileRoute("/_authenticated/overview")({
  component: OverviewPage,
});

function OverviewPage() {
  const statsFn = useServerFn(getSystemStats);
  const listFn = useServerFn(listContainers);

  const stats = useQuery({
    queryKey: ["stats"],
    queryFn: () => statsFn(),
    refetchInterval: 5000,
    refetchIntervalInBackground: false,
  });

  const containers = useQuery({
    queryKey: ["containers"],
    queryFn: () => listFn(),
    refetchInterval: 10000,
    refetchIntervalInBackground: false,
  });

  const s = stats.data;
  const failing = containers.data?.filter((c) => c.status === "exited").length ?? 0;
  const running = containers.data?.filter((c) => c.status === "running").length ?? 0;

  return (
    <div className="px-4 pt-6">
      <header className="flex justify-between items-start mb-7 pt-2">
        <div className="relative pl-3">
          <div className="absolute -left-0 top-0 w-0.5 h-full bg-primary/40 rounded-full" />
          <h2 className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground mb-1">
            System Hub / {s?.hostname ?? "—"}
          </h2>
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="size-2 bg-status-ok rounded-full" />
              <div className="size-2 bg-status-ok rounded-full absolute inset-0 animate-ping opacity-75" />
            </div>
            <span className="font-mono text-xs tracking-tight text-status-ok/90 font-semibold italic">
              LINK · {s?.uptime ?? "—"}
            </span>
          </div>
        </div>
        <div className="px-3 py-1 bg-primary/5 border border-primary/20 rounded-full">
          <span className="text-[10px] uppercase font-bold tracking-widest text-primary">
            {s?.version ?? "—"}
          </span>
        </div>
      </header>

      <section className="grid grid-cols-3 gap-3 mb-7">
        <StatGauge
          label="CPU"
          value={s ? `${Math.round(s.cpu)}` : "—"}
          unit="%"
          pct={s?.cpu ?? 0}
          tone={s && s.cpu > 75 ? "warn" : "ok"}
        />
        <StatGauge
          label="RAM"
          value={s ? `${s.ramUsedGb.toFixed(1)}` : "—"}
          unit="GB"
          pct={s ? (s.ramUsedGb / s.ramTotalGb) * 100 : 0}
          tone={s && s.ramUsedGb / s.ramTotalGb > 0.8 ? "warn" : "ok"}
        />
        <StatGauge
          label="TMP"
          value={s ? `${Math.round(s.tempC)}` : "—"}
          unit="°C"
          pct={s ? (s.tempC / 85) * 100 : 0}
          tone={s && s.tempC > 70 ? "crit" : "accent"}
        />
      </section>

      <div className="flex items-center justify-between mb-4 px-1">
        <h3 className="text-[10px] font-bold uppercase tracking-[0.4em] text-muted-foreground">
          Instance Management
        </h3>
        <div className="font-mono text-[10px] text-primary/70 bg-primary/10 px-2 py-0.5 rounded-sm">
          {running}_RUN · {failing}_FAIL
        </div>
      </div>

      <section className="space-y-3">
        {containers.isLoading && (
          <div className="text-xs font-mono text-muted-foreground p-6 text-center">
            Scanning Docker socket…
          </div>
        )}
        {containers.data?.map((c) => (
          <ContainerCard key={c.id} c={c} />
        ))}
      </section>
    </div>
  );
}
