import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { listAudit } from "@/lib/cloud/cloud.functions";

export const Route = createFileRoute("/_cloud/audit")({
  component: AuditPage,
});

function AuditPage() {
  const fetchAudit = useServerFn(listAudit);
  const { data = [] } = useQuery({
    queryKey: ["audit"],
    queryFn: () => fetchAudit(),
    refetchInterval: 10000,
    refetchIntervalInBackground: false,
  });

  return (
    <div className="px-5 space-y-2">
      <h2 className="text-xs uppercase tracking-widest text-muted-foreground mb-3">
        Telegram-Aktivität
      </h2>
      {data.length === 0 && <p className="text-xs text-muted-foreground">Noch keine Einträge.</p>}
      {data.map((row: any) => (
        <div key={row.id} className="rounded-lg border border-border bg-card p-3 text-xs font-mono">
          <div className="flex justify-between">
            <span className="text-primary">{row.command}</span>
            <span className="text-muted-foreground text-[10px]">
              {new Date(row.created_at).toLocaleString()}
            </span>
          </div>
          {row.result && (
            <p className="text-[10px] text-muted-foreground mt-1 truncate">{row.result}</p>
          )}
        </div>
      ))}
    </div>
  );
}
