import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useRef, useState } from "react";
import { Copy, History, RefreshCw, Search, Square } from "lucide-react";
import { collectDiagnosticsFn } from "@/lib/diagnose.functions";
import { MessageResponse } from "@/components/ai-elements/message";
import { Shimmer } from "@/components/ai-elements/shimmer";

export const Route = createFileRoute("/_authenticated/diagnose")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Diagnose — Pi Control" },
      { name: "description", content: "Fehlerprotokoll einfügen und per KI die wahrscheinliche Ursache samt konkreten Lösungsschritten erhalten." },
      { property: "og:title", content: "Diagnose — Pi Control" },
      { property: "og:description", content: "KI-Fehleranalyse für Node-RED, Alexa, Telegram und Endpunkte." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DiagnosePage,
});

const MAX = 20000;

function DiagnosePage() {
  const collect = useServerFn(collectDiagnosticsFn);
  const [logs, setLogs] = useState("");
  const [attempted, setAttempted] = useState("");
  const [includeConfig, setIncludeConfig] = useState(true);
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadingLines, setLoadingLines] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  async function pullDebug() {
    setLoadingLines(true);
    try {
      const r = await collect();
      setLogs(r.text ? r.text.slice(-MAX) : "");
      if (!r.count) setError("Im Debug-Verlauf gibt es gerade keine Fehler- oder Info-Zeilen.");
      else setError(null);
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setLoadingLines(false);
    }
  }

  async function analyse() {
    if (!logs.trim() || busy) return;
    setBusy(true);
    setAnswer("");
    setError(null);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const token = window.localStorage.getItem("pi-dashboard.token");
      const res = await fetch("/api/diagnose", {
        method: "POST",
        signal: ctrl.signal,
        headers: { "Content-Type": "application/json", ...(token ? { "X-Pi-Auth": token } : {}) },
        body: JSON.stringify({ logs, attempted: attempted || undefined, includeConfig }),
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error || `Fehler ${res.status}`);
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let acc = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        acc += dec.decode(value, { stream: true });
        setAnswer(acc);
      }
      if (!acc.trim()) setError("Die KI hat keine Antwort geliefert. Bitte später erneut versuchen.");
    } catch (e) {
      if ((e as Error)?.name !== "AbortError") {
        const msg = String((e as Error)?.message ?? e);
        setError(
          /402|credit|guthaben/i.test(msg)
            ? "KI-Guthaben aufgebraucht. Aufladen unter Einstellungen → Pläne & Guthaben."
            : msg,
        );
      }
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }

  return (
    <div className="px-5 pb-28 space-y-4">
      <div>
        <h2 className="text-xs uppercase tracking-widest text-muted-foreground mb-1">Diagnose</h2>
        <p className="text-xs text-muted-foreground">
          Fehlerprotokoll einfügen — die KI nennt die wahrscheinliche Ursache und konkrete Schritte.
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <label htmlFor="logs" className="text-xs font-medium">Fehlerprotokoll</label>
          <button
            type="button"
            onClick={pullDebug}
            disabled={loadingLines}
            className="text-xs inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 hover:bg-muted disabled:opacity-50"
          >
            <History className="size-3" /> Letzte Debug-Zeilen übernehmen
          </button>
        </div>
        <textarea
          id="logs"
          value={logs}
          maxLength={MAX}
          onChange={(e) => setLogs(e.target.value)}
          rows={10}
          placeholder="z. B. Node-RED: 401 Unauthorized bei POST /api/public/ingest/live …"
          className="w-full rounded-xl border border-border bg-background p-3 font-mono text-xs"
        />
        <div className="text-[10px] text-muted-foreground text-right">{logs.length} / {MAX}</div>
        <input
          value={attempted}
          maxLength={500}
          onChange={(e) => setAttempted(e.target.value)}
          placeholder="Was hast du gerade versucht? (optional)"
          className="w-full rounded-xl border border-border bg-background p-2 text-xs"
        />
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={includeConfig} onChange={(e) => setIncludeConfig(e.target.checked)} />
          Endpunkt-Konfiguration mitschicken
        </label>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={analyse}
            disabled={!logs.trim() || busy}
            className="inline-flex items-center gap-2 rounded-xl bg-primary text-primary-foreground px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            <Search className="size-4" /> Analysieren
          </button>
          {busy && (
            <button type="button" onClick={() => abortRef.current?.abort()} className="inline-flex items-center gap-1 rounded-xl border border-border px-3 py-2 text-sm">
              <Square className="size-3" /> Stopp
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-xs">{error}</div>
      )}

      {(busy || answer) && (
        <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
          {answer ? <MessageResponse>{answer}</MessageResponse> : <Shimmer>Analysiere…</Shimmer>}
          {!busy && answer && (
            <div className="flex gap-2">
              <button type="button" onClick={() => navigator.clipboard.writeText(answer)} className="text-xs inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1">
                <Copy className="size-3" /> Antwort kopieren
              </button>
              <button type="button" onClick={analyse} className="text-xs inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1">
                <RefreshCw className="size-3" /> Neu analysieren
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
