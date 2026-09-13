import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { Cable, Power, RefreshCw, SlidersHorizontal, Wifi, WifiOff } from "lucide-react";
import { auth } from "@/lib/auth-store";
import { invokeEndpointFn, listEndpointsFn } from "@/lib/registry.functions";

export const Route = createFileRoute("/_authenticated/control")({
  head: () => ({
    meta: [
      { title: "Steuerung — Pi Control" },
      {
        name: "description",
        content:
          "Alle von Node-RED gemeldeten Endpunkte live steuern: schalten, Werte setzen, Zustand sehen — direkt auf dem Raspberry Pi.",
      },
      { property: "og:title", content: "Steuerung — Pi Control" },
      {
        property: "og:description",
        content: "Endpunkte aus Node-RED live schalten und beobachten.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ControlPage,
});

type Ep = {
  id: string;
  label?: string;
  kind: "read" | "switch" | "number" | "action";
  unit?: string;
  min?: number;
  max?: number;
  options?: string[];
  group?: string;
  description?: string;
  value?: unknown;
  valueAt?: string;
  voice: boolean;
  control: boolean;
  config: { hidden?: boolean };
};

function fmt(v: unknown, unit?: string) {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "an" : "aus";
  if (typeof v === "number") return `${Math.round(v * 100) / 100}${unit ? ` ${unit}` : ""}`;
  return `${String(v)}${unit ? ` ${unit}` : ""}`;
}

/** Live values pushed by Node-RED arrive on the local SSE stream. */
function useLiveValues() {
  const [values, setValues] = useState<Record<string, { value: unknown; ts: string }>>({});
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const token = auth.token;
    const es = new EventSource(`/api/live-stream${token ? `?t=${encodeURIComponent(token)}` : ""}`);
    const up = () => setConnected(true);
    es.addEventListener("hello", up);
    es.addEventListener("ping", up);
    es.addEventListener("tick", (e) => {
      try {
        const d = JSON.parse((e as MessageEvent).data) as {
          endpoint?: string;
          value?: unknown;
          ts?: string;
        };
        if (!d?.endpoint) return;
        setValues((p) => ({
          ...p,
          [d.endpoint!]: { value: d.value, ts: d.ts ?? new Date().toISOString() },
        }));
      } catch {
        /* ignore */
      }
    });
    es.onerror = () => setConnected(false);
    return () => es.close();
  }, []);

  return { values, connected };
}

function ControlPage() {
  const listFn = useServerFn(listEndpointsFn);
  const invokeFn = useServerFn(invokeEndpointFn);
  const qc = useQueryClient();
  const { values, connected } = useLiveValues();
  const [note, setNote] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ["endpoints"],
    queryFn: () => listFn(),
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });

  const invoke = useMutation({
    mutationFn: (v: { id: string; value?: string | number | boolean }) => invokeFn({ data: v }),
    onSuccess: (r) => {
      setNote(r.ok ? `${r.id}: gesendet` : `${r.id}: ${r.error}`);
      qc.invalidateQueries({ queryKey: ["endpoints"] });
    },
    onError: (e) => setNote(String((e as Error).message)),
  });

  const groups = useMemo(() => {
    const eps = ((q.data?.endpoints ?? []) as Ep[]).filter((e) => !e.config?.hidden);
    const map = new Map<string, Ep[]>();
    for (const e of eps) {
      const g = e.group || "Allgemein";
      map.set(g, [...(map.get(g) ?? []), e]);
    }
    return [...map.entries()];
  }, [q.data]);

  const total = q.data?.registry.count ?? 0;

  return (
    <div className="px-5 pt-6 space-y-4">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Steuerung</h1>
          <p className="text-[11px] text-muted-foreground">
            {total} Endpunkt{total === 1 ? "" : "e"} von Node-RED gemeldet
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span
            className={`inline-flex items-center gap-1 text-[10px] uppercase tracking-widest ${connected ? "text-primary" : "text-muted-foreground"}`}
          >
            {connected ? <Wifi size={12} /> : <WifiOff size={12} />} live
          </span>
          <button
            onClick={() => q.refetch()}
            aria-label="Neu laden"
            className="text-muted-foreground"
          >
            <RefreshCw size={14} className={q.isFetching ? "animate-spin" : ""} />
          </button>
        </div>
      </header>

      {note && <p className="text-[11px] text-muted-foreground font-mono">{note}</p>}

      {total === 0 && (
        <section className="rounded-2xl border border-dashed border-border p-5 space-y-2">
          <Cable size={18} className="text-primary" />
          <h2 className="text-sm font-semibold">Noch keine Endpunkte</h2>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Node-RED meldet seine Endpunkte selbst an. Importiere den Flow von der Node-RED-Seite,
            drücke Deploy — danach erscheinen hier automatisch alle Schalter und Werte.
          </p>
          <Link
            to="/integrations"
            className="inline-block text-[10px] uppercase tracking-widest text-primary"
          >
            Node-RED einrichten →
          </Link>
        </section>
      )}

      {groups.map(([group, eps]) => (
        <section key={group} className="space-y-2">
          <h2 className="text-[10px] uppercase tracking-widest text-muted-foreground">{group}</h2>
          <div className="space-y-2">
            {eps.map((e) => {
              const live = values[e.id];
              const value = live ? live.value : e.value;
              const at = live?.ts ?? e.valueAt;
              return (
                <article key={e.id} className="rounded-2xl border border-border bg-card p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="text-sm font-medium truncate">{e.label || e.id}</h3>
                      <p className="text-[10px] font-mono text-muted-foreground truncate">{e.id}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-base font-semibold tabular-nums">
                        {fmt(value, e.unit)}
                      </div>
                      {at && (
                        <div className="text-[10px] text-muted-foreground">
                          {new Date(at).toLocaleTimeString("de-DE")}
                        </div>
                      )}
                    </div>
                  </div>

                  {e.description && (
                    <p className="mt-2 text-[11px] text-muted-foreground">{e.description}</p>
                  )}

                  {e.control && (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {e.kind === "switch" && (
                        <>
                          <button
                            onClick={() => invoke.mutate({ id: e.id, value: true })}
                            className="rounded-xl bg-primary/15 text-primary px-3 py-1.5 text-[11px] font-semibold uppercase tracking-widest"
                          >
                            an
                          </button>
                          <button
                            onClick={() => invoke.mutate({ id: e.id, value: false })}
                            className="rounded-xl bg-muted px-3 py-1.5 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground"
                          >
                            aus
                          </button>
                        </>
                      )}
                      {e.kind === "action" && (
                        <button
                          onClick={() => invoke.mutate({ id: e.id, value: true })}
                          className="inline-flex items-center gap-1 rounded-xl bg-primary/15 text-primary px-3 py-1.5 text-[11px] font-semibold uppercase tracking-widest"
                        >
                          <Power size={12} /> ausführen
                        </button>
                      )}
                      {e.kind === "number" && <NumberControl ep={e} onSend={invoke.mutate} />}
                      {e.options?.length ? (
                        <select
                          onChange={(ev) =>
                            ev.target.value && invoke.mutate({ id: e.id, value: ev.target.value })
                          }
                          defaultValue=""
                          className="rounded-xl bg-muted px-3 py-1.5 text-[11px]"
                        >
                          <option value="">wählen…</option>
                          {e.options.map((o) => (
                            <option key={o} value={o}>
                              {o}
                            </option>
                          ))}
                        </select>
                      ) : null}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      ))}

      {total > 0 && (
        <Link
          to="/tuning"
          className="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest text-primary"
        >
          <SlidersHorizontal size={12} /> Feintuning
        </Link>
      )}
    </div>
  );
}

function NumberControl({
  ep,
  onSend,
}: {
  ep: Ep;
  onSend: (v: { id: string; value: number }) => void;
}) {
  const [v, setV] = useState<string>(
    typeof ep.value === "number" ? String(ep.value) : String(ep.min ?? 0),
  );
  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        value={v}
        min={ep.min}
        max={ep.max}
        onChange={(e) => setV(e.target.value)}
        className="w-24 rounded-xl bg-muted px-3 py-1.5 text-[12px] tabular-nums"
      />
      <button
        onClick={() => {
          const n = Number(v);
          if (Number.isFinite(n)) onSend({ id: ep.id, value: n });
        }}
        className="rounded-xl bg-primary/15 text-primary px-3 py-1.5 text-[11px] font-semibold uppercase tracking-widest"
      >
        setzen
      </button>
    </div>
  );
}
