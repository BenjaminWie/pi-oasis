import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Bug,
  Info,
  RefreshCw,
  Send,
  Wifi,
  WifiOff,
} from "lucide-react";
import { auth } from "@/lib/auth-store";
import {
  getDebugFn,
  invokeEndpointFn,
  listEndpointsFn,
  setDebugVerboseFn,
  simulateVoiceFn,
} from "@/lib/registry.functions";

export const Route = createFileRoute("/_authenticated/debug")({
  head: () => ({
    meta: [
      { title: "Debug — Pi Control" },
      {
        name: "description",
        content:
          "Live-Strom aller Nachrichten je Kanal, Alexa- und Telegram-Testfeld, ausführliches Protokoll und Testschuss auf jeden Endpunkt.",
      },
      { property: "og:title", content: "Debug — Pi Control" },
      {
        property: "og:description",
        content: "Nachrichtenstrom je Kanal, Sprachtest und Testschuss für jeden Endpunkt.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DebugPage,
});

type Channel = "node-red" | "alexa" | "telegram" | "chat" | "rules" | "local";
type Entry = {
  ts: string;
  dir: "in" | "out" | "error" | "info";
  channel?: Channel;
  what: string;
  detail?: unknown;
  ms?: number;
};

const DIRS = ["all", "in", "out", "error"] as const;
const CHANNELS: Array<{ id: "all" | Channel; label: string }> = [
  { id: "all", label: "alle" },
  { id: "node-red", label: "Node-RED" },
  { id: "alexa", label: "Alexa" },
  { id: "telegram", label: "Telegram" },
  { id: "chat", label: "Chat" },
  { id: "rules", label: "Regeln" },
  { id: "local", label: "Lokal" },
];

function DebugPage() {
  const debugFn = useServerFn(getDebugFn);
  const listFn = useServerFn(listEndpointsFn);
  const invokeFn = useServerFn(invokeEndpointFn);
  const simulateFn = useServerFn(simulateVoiceFn);
  const verboseFn = useServerFn(setDebugVerboseFn);

  const [live, setLive] = useState<Entry[]>([]);
  const [connected, setConnected] = useState(false);
  const [filter, setFilter] = useState<(typeof DIRS)[number]>("all");
  const [channel, setChannel] = useState<"all" | Channel>("all");
  const [text, setText] = useState("");
  const [testOut, setTestOut] = useState<string | null>(null);
  const [simChannel, setSimChannel] = useState<"alexa" | "telegram">("alexa");
  const [simText, setSimText] = useState("");

  const q = useQuery({ queryKey: ["debug"], queryFn: () => debugFn(), refetchInterval: 30_000 });
  const eps = useQuery({ queryKey: ["endpoints"], queryFn: () => listFn() });

  const test = useMutation({
    mutationFn: (id: string) => invokeFn({ data: { id, value: true, force: true } }),
    onSuccess: (r) => setTestOut(JSON.stringify(r)),
    onError: (e) => setTestOut(String((e as Error).message)),
  });

  const sim = useMutation({
    mutationFn: () => simulateFn({ data: { channel: simChannel, text: simText.trim() } }),
  });

  const verbose = useMutation({
    mutationFn: (v: { channel: Channel; on: boolean }) => verboseFn({ data: v }),
    onSuccess: () => q.refetch(),
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const token = auth.token;
    const es = new EventSource(`/api/live-stream${token ? `?t=${encodeURIComponent(token)}` : ""}`);
    const up = () => setConnected(true);
    es.addEventListener("hello", up);
    es.addEventListener("ping", up);
    es.addEventListener("trace", (e) => {
      try {
        const d = JSON.parse((e as MessageEvent).data) as Entry;
        if (!d?.what) return;
        setLive((p) => [d, ...p].slice(0, 300));
      } catch {
        /* ignore */
      }
    });
    es.onerror = () => setConnected(false);
    return () => es.close();
  }, []);

  const entries = useMemo(() => {
    const base = [...live, ...((q.data?.entries ?? []) as Entry[])];
    const seen = new Set<string>();
    return base
      .filter((e) => {
        const k = `${e.ts}|${e.what}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .filter((e) => (filter === "all" ? true : e.dir === filter))
      .filter((e) => (channel === "all" ? true : (e.channel ?? "local") === channel))
      .filter((e) =>
        text.trim()
          ? `${e.what} ${JSON.stringify(e.detail ?? "")}`.toLowerCase().includes(text.toLowerCase())
          : true,
      )
      .slice(0, 200);
  }, [live, q.data, filter, channel, text]);

  const reg = q.data?.registry;
  const storage = q.data?.storage as Record<string, unknown> | undefined;
  const verboseState = (q.data?.verbose ?? {}) as Record<string, boolean>;

  return (
    <div className="px-5 pt-6 space-y-4">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Debug</h1>
          <p className="text-[11px] text-muted-foreground">
            {reg?.count ?? 0} Endpunkte · letzte Meldung{" "}
            {reg?.lastAnnounceAt ? new Date(reg.lastAnnounceAt).toLocaleTimeString("de-DE") : "—"}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span
            className={`inline-flex items-center gap-1 text-[10px] uppercase tracking-widest ${connected ? "text-primary" : "text-muted-foreground"}`}
          >
            {connected ? <Wifi size={12} /> : <WifiOff size={12} />} live
          </span>
          <button onClick={() => q.refetch()} aria-label="Neu laden">
            <RefreshCw size={14} className={q.isFetching ? "animate-spin" : ""} />
          </button>
        </div>
      </header>

      {/* -------------------------------------------------- Alexa / Telegram test */}
      <section className="rounded-2xl border border-border bg-card p-4 space-y-2">
        <h2 className="text-[10px] uppercase tracking-widest text-muted-foreground">
          Sprachtest — als käme es von …
        </h2>
        <div className="flex gap-2">
          {(["alexa", "telegram"] as const).map((c) => (
            <button
              key={c}
              onClick={() => setSimChannel(c)}
              className={`rounded-xl px-3 py-1.5 text-[10px] uppercase tracking-widest ${simChannel === c ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"}`}
            >
              {c}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            value={simText}
            onChange={(e) => setSimText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && simText.trim()) sim.mutate();
            }}
            placeholder="Pumpe an für 5 Minuten"
            className="flex-1 rounded-xl bg-muted px-3 py-2 text-xs"
          />
          <button
            onClick={() => simText.trim() && sim.mutate()}
            disabled={sim.isPending || !simText.trim()}
            className="rounded-xl bg-primary/15 px-3 py-2 text-primary disabled:opacity-40"
            aria-label="Senden"
          >
            <Send size={14} />
          </button>
        </div>
        {sim.isPending && <p className="text-[11px] text-muted-foreground">frage den Pi…</p>}
        {sim.data && (
          <p className="rounded-xl bg-muted p-2 text-[11px]">
            <span className="text-muted-foreground">
              {sim.data.via === "ai" ? "Assistent" : "Direkt"}:{" "}
            </span>
            {sim.data.speech}
          </p>
        )}
        {sim.error && (
          <p className="text-[11px] text-destructive">{String((sim.error as Error).message)}</p>
        )}
      </section>

      {/* -------------------------------------------------------- verbose switches */}
      <section className="rounded-2xl border border-border bg-card p-4">
        <h2 className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">
          Ausführliches Protokoll
        </h2>
        <div className="flex flex-wrap gap-2">
          {CHANNELS.filter((c) => c.id !== "all").map((c) => {
            const on = Boolean(verboseState[c.id]);
            return (
              <button
                key={c.id}
                onClick={() => verbose.mutate({ channel: c.id as Channel, on: !on })}
                className={`rounded-xl px-3 py-1.5 text-[10px] uppercase tracking-widest ${on ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"}`}
              >
                {c.label}
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-[10px] text-muted-foreground">
          An: rohe Anfrage und Antwort landen im Strom. Standard aus, damit nichts zumüllt.
        </p>
      </section>

      <section className="rounded-2xl border border-border bg-card p-4 space-y-2">
        <h2 className="text-[10px] uppercase tracking-widest text-muted-foreground">Testschuss</h2>
        <div className="flex flex-wrap gap-2">
          {((eps.data?.endpoints ?? []) as Array<{ id: string; kind: string; label?: string }>)
            .filter((e) => e.kind !== "read")
            .map((e) => (
              <button
                key={e.id}
                onClick={() => test.mutate(e.id)}
                className="rounded-xl bg-muted px-3 py-1.5 text-[11px] font-mono"
              >
                {e.id}
              </button>
            ))}
          {((eps.data?.endpoints ?? []) as Array<{ kind: string }>).every(
            (e) => e.kind === "read",
          ) && <p className="text-xs text-muted-foreground">Kein schaltbarer Endpunkt gemeldet.</p>}
        </div>
        {testOut && (
          <pre className="mt-1 max-h-32 overflow-auto rounded-xl bg-muted p-2 text-[10px] font-mono whitespace-pre-wrap break-all">
            {testOut}
          </pre>
        )}
      </section>

      <section className="rounded-2xl border border-border bg-card p-4">
        <h2 className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">
          Lokaler Speicher
        </h2>
        <dl className="grid grid-cols-2 gap-1 text-[11px]">
          {Object.entries(storage ?? {}).map(([k, v]) => (
            <div key={k} className="flex justify-between gap-2">
              <dt className="text-muted-foreground truncate">{k}</dt>
              <dd className="font-mono truncate">{String(v)}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* ------------------------------------------------------------- filters */}
      <div className="flex flex-wrap items-center gap-2">
        {CHANNELS.map((c) => (
          <button
            key={c.id}
            onClick={() => setChannel(c.id)}
            className={`rounded-xl px-2.5 py-1 text-[10px] uppercase tracking-widest ${channel === c.id ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"}`}
          >
            {c.label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        {DIRS.map((d) => (
          <button
            key={d}
            onClick={() => setFilter(d)}
            className={`rounded-xl px-3 py-1.5 text-[10px] uppercase tracking-widest ${filter === d ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"}`}
          >
            {d}
          </button>
        ))}
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="filtern…"
          className="ml-auto w-28 rounded-xl bg-muted px-3 py-1.5 text-[11px]"
        />
      </div>

      <ul className="space-y-1.5">
        {entries.map((e, i) => {
          const Icon =
            e.dir === "out"
              ? ArrowUpRight
              : e.dir === "in"
                ? ArrowDownLeft
                : e.dir === "error"
                  ? Bug
                  : Info;
          const color =
            e.dir === "error"
              ? "text-destructive"
              : e.dir === "out"
                ? "text-primary"
                : "text-muted-foreground";
          return (
            <li key={`${e.ts}-${i}`} className="rounded-xl border border-border bg-card p-2.5">
              <div className="flex items-center gap-2">
                <Icon size={12} className={`shrink-0 ${color}`} />
                <span className="rounded bg-muted px-1.5 py-0.5 text-[9px] uppercase tracking-widest text-muted-foreground shrink-0">
                  {e.channel ?? "local"}
                </span>
                <span className="text-[11px] font-medium truncate">{e.what}</span>
                <span className="ml-auto text-[10px] text-muted-foreground shrink-0">
                  {e.ms != null ? `${e.ms} ms · ` : ""}
                  {new Date(e.ts).toLocaleTimeString("de-DE")}
                </span>
              </div>
              {e.detail != null && (
                <pre className="mt-1 max-h-24 overflow-auto text-[10px] font-mono text-muted-foreground whitespace-pre-wrap break-all">
                  {JSON.stringify(e.detail)}
                </pre>
              )}
            </li>
          );
        })}
        {entries.length === 0 && (
          <li className="text-xs text-muted-foreground">Noch keine Nachrichten.</li>
        )}
      </ul>
    </div>
  );
}
