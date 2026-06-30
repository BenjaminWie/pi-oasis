import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Plus, Trash2, Copy, Check, Bot, ShieldCheck, Zap, ArrowLeft } from "lucide-react";
import {
  listMcpTokens,
  createMcpToken,
  deleteMcpToken,
  listMcpAudit,
} from "@/lib/mcp-tokens.functions";
import { listDevices } from "@/lib/cloud.functions";

export const Route = createFileRoute("/_cloud/connections/mcp")({
  component: McpPage,
});

function McpPage() {
  const fetchTokens = useServerFn(listMcpTokens);
  const fetchDevices = useServerFn(listDevices);
  const fetchAudit = useServerFn(listMcpAudit);
  const createFn = useServerFn(createMcpToken);
  const deleteFn = useServerFn(deleteMcpToken);
  const qc = useQueryClient();

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [deviceId, setDeviceId] = useState("");
  const [scopeControl, setScopeControl] = useState(false);
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const { data: tokens = [] } = useQuery({
    queryKey: ["mcp-tokens"],
    queryFn: () => fetchTokens(),
  });
  const { data: devices = [] } = useQuery({
    queryKey: ["devices"],
    queryFn: () => fetchDevices(),
  });
  const { data: audit = [] } = useQuery({
    queryKey: ["mcp-audit"],
    queryFn: () => fetchAudit(),
    refetchInterval: 10_000,
  });

  const create = useMutation({
    mutationFn: () =>
      createFn({
        data: {
          name,
          deviceId,
          scopes: scopeControl ? ["read", "control"] : ["read"],
        },
      }),
    onSuccess: (d: any) => {
      setCreatedToken(d.token);
      setShowForm(false);
      setName("");
      qc.invalidateQueries({ queryKey: ["mcp-tokens"] });
    },
  });

  const del = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["mcp-tokens"] }),
  });

  const origin =
    typeof window !== "undefined" ? window.location.origin : "https://pi-hub.benniwie.com";
  const mcpUrl = `${origin}/api/public/mcp`;

  function copy(label: string, text: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(label);
      setTimeout(() => setCopied(null), 1500);
    });
  }

  return (
    <div className="px-5 space-y-6">
      <Link
        to="/connections"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground mb-2"
      >
        <ArrowLeft size={14} /> zurück
      </Link>
      <div>
        <h2 className="text-xs uppercase tracking-widest text-muted-foreground mb-1">MCP Server</h2>
        <p className="text-xs text-muted-foreground">
          Verbinde ChatGPT, Gemini, Claude, Alexa oder andere Modelle mit deinem Pi.
        </p>
        <div className="mt-3 rounded-2xl border border-border bg-card p-4 font-mono text-xs break-all">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">
            Endpoint
          </div>
          <div className="flex items-center justify-between gap-2">
            <span>{mcpUrl}</span>
            <button onClick={() => copy("url", mcpUrl)} className="text-primary">
              {copied === "url" ? <Check size={14} /> : <Copy size={14} />}
            </button>
          </div>
        </div>
      </div>

      {createdToken && (
        <div className="rounded-2xl border-2 border-primary bg-primary/5 p-4 space-y-3">
          <div className="flex items-center gap-2 text-primary text-xs uppercase tracking-widest">
            <ShieldCheck size={14} /> Token erstellt
          </div>
          <p className="text-xs text-muted-foreground">
            Kopiere jetzt — wird nicht erneut angezeigt.
          </p>
          <div className="rounded bg-background border border-border p-3 font-mono text-[11px] break-all">
            {createdToken}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => copy("token", createdToken)}
              className="flex-1 rounded-lg bg-primary text-primary-foreground py-2 text-xs uppercase tracking-widest flex items-center justify-center gap-1"
            >
              {copied === "token" ? <Check size={14} /> : <Copy size={14} />} Token
            </button>
            <button
              onClick={() => setCreatedToken(null)}
              className="flex-1 rounded-lg border border-border py-2 text-xs uppercase tracking-widest"
            >
              Schließen
            </button>
          </div>
          <details className="text-[11px] text-muted-foreground">
            <summary className="cursor-pointer">Claude Desktop config</summary>
            <pre className="mt-2 rounded bg-background border border-border p-2 overflow-x-auto">
              {`{
  "mcpServers": {
    "pi-hub": {
      "url": "${mcpUrl}",
      "headers": { "Authorization": "Bearer ${createdToken}" }
    }
  }
}`}
            </pre>
          </details>
        </div>
      )}

      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs uppercase tracking-widest text-muted-foreground">Tokens</h3>
          <button
            onClick={() => setShowForm((v) => !v)}
            className="rounded-lg bg-primary text-primary-foreground px-3 py-1.5 text-xs uppercase tracking-widest flex items-center gap-1"
          >
            <Plus size={14} /> Neu
          </button>
        </div>

        {showForm && (
          <div className="rounded-2xl border border-border bg-card p-4 mb-4 space-y-3">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Token-Name z.B. ChatGPT"
              className="w-full rounded-lg bg-background border border-border px-3 py-2 font-mono text-sm"
            />
            <select
              value={deviceId}
              onChange={(e) => setDeviceId(e.target.value)}
              className="w-full rounded-lg bg-background border border-border px-3 py-2 font-mono text-sm"
            >
              <option value="">Gerät wählen…</option>
              {devices.map((d: any) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={scopeControl}
                onChange={(e) => setScopeControl(e.target.checked)}
              />
              <Zap size={12} className="text-primary" />
              Steuerung erlauben (Pumpe, Container, MQTT)
            </label>
            <button
              onClick={() => create.mutate()}
              disabled={!name || !deviceId || create.isPending}
              className="w-full rounded-lg bg-primary text-primary-foreground py-2 text-xs uppercase tracking-widest disabled:opacity-50"
            >
              Token generieren
            </button>
          </div>
        )}

        <div className="space-y-2">
          {tokens.map((t: any) => (
            <div
              key={t.id}
              className="rounded-2xl border border-border bg-card p-3 flex items-center gap-3"
            >
              <Bot size={18} className="text-primary shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-mono truncate">{t.name}</div>
                <div className="text-[10px] text-muted-foreground font-mono">
                  {t.token_prefix}… · {t.scopes.join(", ")}
                  {t.last_used_at &&
                    ` · letzte Nutzung ${new Date(t.last_used_at).toLocaleString()}`}
                </div>
              </div>
              <button
                onClick={() => del.mutate(t.id)}
                className="text-muted-foreground hover:text-destructive"
                aria-label="Token löschen"
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
          {tokens.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-6">
              Noch keine Tokens. Erzeuge eins für deine KI.
            </p>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-4 space-y-2">
        <h3 className="text-xs uppercase tracking-widest text-muted-foreground">
          Was kann ich fragen?
        </h3>
        <ul className="text-[11px] space-y-1 text-muted-foreground">
          <li>
            • <span className="text-foreground">"Ist meine Wäsche fertig?"</span> →{" "}
            <code className="text-primary">infer_appliance_state</code>
          </li>
          <li>
            • <span className="text-foreground">"Wie teuer ist Strom gerade?"</span> →{" "}
            <code className="text-primary">get_tibber_price_now</code>
          </li>
          <li>
            • <span className="text-foreground">"Zeig mir die Leistung der letzten Stunde."</span> →{" "}
            <code className="text-primary">get_power_history</code>
          </li>
          <li>
            • <span className="text-foreground">"Schalt die Zisterne für 10 Minuten an."</span> →{" "}
            <code className="text-primary">pump_set</code>
          </li>
          <li>
            • <span className="text-foreground">"Was läuft gerade auf dem Pi?"</span> →{" "}
            <code className="text-primary">list_containers</code>
          </li>
        </ul>
        <p className="text-[10px] text-muted-foreground pt-1">
          Tipp: Lege in deinem Gerät unter <em>Geräte-Detail → Appliance-Profile</em> Schwellwerte
          für deine Waschmaschine fest (Standard: 150 W läuft, &lt; 5 W = fertig).
        </p>
      </div>

      <div>
        <h3 className="text-xs uppercase tracking-widest text-muted-foreground mb-3">
          Audit (letzte 200)
        </h3>
        <div className="space-y-1.5 font-mono text-[11px]">
          {audit.slice(0, 30).map((a: any) => (
            <div
              key={a.id}
              className="rounded-lg border border-border bg-card px-3 py-2 flex items-center gap-2"
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  a.status === "ok"
                    ? "bg-primary"
                    : a.status === "denied"
                      ? "bg-yellow-500"
                      : "bg-destructive"
                }`}
              />
              <span className="font-bold">{a.tool}</span>
              <span className="text-muted-foreground">{a.status}</span>
              {a.latency_ms != null && (
                <span className="text-muted-foreground">{a.latency_ms}ms</span>
              )}
              <span className="ml-auto text-muted-foreground">
                {new Date(a.created_at).toLocaleTimeString()}
              </span>
            </div>
          ))}
          {audit.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-4">
              Noch keine MCP-Aufrufe.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
