// Pi-local integration center: every URL/token a Node-RED flow or external
// tool needs to talk to this Pi + the cloud. Built so the user never has to
// SSH in or hunt through .env / settings to wire up Tab "1. Cloud-Bridge".

import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  Cable,
  Copy,
  Check,
  Download,
  ExternalLink,
  Cloud,
  Network,
  AlertTriangle,
  CheckCircle2,
  Eye,
  EyeOff,
} from "lucide-react";
import { getCloudDeviceToken, getIntegrationsInfo } from "@/lib/integrations.functions";

export const Route = createFileRoute("/_authenticated/integrations")({
  component: IntegrationsPage,
});

function IntegrationsPage() {
  const fetchInfo = useServerFn(getIntegrationsInfo);
  const fetchToken = useServerFn(getCloudDeviceToken);
  const { data: info } = useQuery({
    queryKey: ["integrations-info"],
    queryFn: () => fetchInfo(),
    refetchInterval: 15_000,
  });
  const [copied, setCopied] = useState<string | null>(null);
  const [revealedToken, setRevealedToken] = useState<string | null>(null);
  const [tokenError, setTokenError] = useState<string | null>(null);

  function copy(label: string, text: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(label);
      setTimeout(() => setCopied(null), 1500);
    });
  }

  function Row({ label, value, secret }: { label: string; value: string | null; secret?: boolean }) {
    return (
      <div className="rounded-xl border border-border bg-background p-3">
        <div className="text-[9px] uppercase tracking-widest text-muted-foreground mb-1">
          {label}
        </div>
        <div className="flex items-center justify-between gap-2">
          <code className="font-mono text-[11px] break-all">
            {value ?? <span className="text-muted-foreground">— nicht verfügbar —</span>}
          </code>
          {value && (
            <button
              onClick={() => copy(label, value)}
              className="text-primary shrink-0"
              aria-label={`${label} kopieren`}
            >
              {copied === label ? <Check size={14} /> : <Copy size={14} />}
            </button>
          )}
        </div>
        {secret && (
          <p className="text-[9px] text-muted-foreground mt-1">
            Token nicht im Klartext — verwende den Pairing-Flow in den Einstellungen.
          </p>
        )}
      </div>
    );
  }

  async function revealToken() {
    setTokenError(null);
    const res = await fetchToken();
    if (res.token) setRevealedToken(res.token);
    else setTokenError(res.error || "Token nicht verfügbar");
  }

  return (
    <div className="px-4 pb-8 space-y-5 max-w-md mx-auto">
      <header className="flex items-center gap-2 pt-2">
        <Cable className="size-5 text-primary" />
        <div>
          <h1 className="text-base font-bold">Node-RED & Integrationen</h1>
          <p className="text-[11px] text-muted-foreground">
            Alles, was dein Flow zum Senden braucht.
          </p>
        </div>
      </header>

      {/* Cloud-Bridge */}
      <section className="space-y-2">
        <div className="flex items-center gap-2">
          <Cloud size={14} className="text-primary" />
          <h2 className="text-[10px] uppercase tracking-widest text-muted-foreground">
            1. Cloud-Bridge
          </h2>
          {info?.cloudBridge.deviceTokenPresent ? (
            <span className="ml-auto inline-flex items-center gap-1 text-[10px] text-primary">
              <CheckCircle2 size={11} /> gepaart
            </span>
          ) : (
            <span className="ml-auto inline-flex items-center gap-1 text-[10px] text-amber-500">
              <AlertTriangle size={11} /> nicht gepaart
            </span>
          )}
        </div>
        <Row label="CLOUD_BRIDGE_URL" value={info?.cloudBridge.eventUrl ?? null} />
        <Row label="CLOUD_STRATEGY_URL" value={info?.cloudBridge.strategyUrl ?? null} />
        <Row label="CLOUD_COMMAND_POLL_URL" value={info?.cloudBridge.commandPollUrl ?? null} />
        <Row label="CLOUD_COMMAND_RESULT_URL" value={info?.cloudBridge.commandResultUrl ?? null} />
        <Row
          label="CLOUD_DEVICE_TOKEN"
          value={revealedToken ?? (info?.cloudBridge.deviceTokenPrefix ? `${info.cloudBridge.deviceTokenPrefix}…` : null)}
          secret={!revealedToken}
        />
        {info?.cloudBridge.deviceTokenPresent && (
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => (revealedToken ? setRevealedToken(null) : revealToken())}
              className="rounded-xl border border-border bg-card py-2 text-[10px] uppercase tracking-widest flex items-center justify-center gap-1"
            >
              {revealedToken ? <EyeOff size={12} /> : <Eye size={12} />}
              {revealedToken ? "Verbergen" : "Token anzeigen"}
            </button>
            <button
              disabled={!revealedToken}
              onClick={() => revealedToken && copy("CLOUD_DEVICE_TOKEN", revealedToken)}
              className="rounded-xl border border-border bg-card py-2 text-[10px] uppercase tracking-widest flex items-center justify-center gap-1 disabled:opacity-40"
            >
              {copied === "CLOUD_DEVICE_TOKEN" ? <Check size={12} /> : <Copy size={12} />}
              Token kopieren
            </button>
          </div>
        )}
        {tokenError && <p className="text-[10px] text-destructive">{tokenError}</p>}
        <p className="text-[10px] text-muted-foreground">
          Für Node-RED immer diesen Cloud Device Token verwenden — nicht Factory-, Reset- oder
          Revocation-Token. Im Node-RED HTTP Request keine eingebaute Bearer-Auth aktivieren; der
          Flow setzt den Header selbst.
        </p>
        {!info?.cloudBridge.deviceTokenPresent && (
          <p className="text-[11px] text-muted-foreground">
            Erst pairen in <code>System → Cloud verbinden</code>, dann kannst du den Token hier
            anzeigen und in den Node-RED-Env-Block kopieren.
          </p>
        )}
      </section>

      {/* Local fallback */}
      <section className="space-y-2">
        <div className="flex items-center gap-2">
          <Network size={14} className="text-primary" />
          <h2 className="text-[10px] uppercase tracking-widest text-muted-foreground">
            2. Lokaler Fallback
          </h2>
        </div>
        <Row label="LOCAL_API_URL" value={info?.local.ingestUrl ?? null} />
        <Row
          label="PI_INGEST_TOKEN"
          value={info?.local.ingestTokenPrefix ? `${info.local.ingestTokenPrefix}…` : "LAN-only"}
          secret={!!info?.local.ingestTokenPrefix}
        />
        <p className="text-[10px] text-muted-foreground">
          IP automatisch aus dem ersten privaten Interface erkannt
          {info?.local.lanIp ? ` (${info.local.lanIp})` : ""}. Bei Cloud-Ausfall pushst du auf die
          lokale Ingest-Route. Wenn kein PI_INGEST_TOKEN gesetzt ist, akzeptiert sie nur LAN-Clients.
        </p>
      </section>

      {/* Quick actions */}
      <section className="space-y-2">
        <h2 className="text-[10px] uppercase tracking-widest text-muted-foreground">
          Schnellstart
        </h2>
        <div className="grid grid-cols-2 gap-2">
          <a
            href="/nodered-template.json"
            download
            className="rounded-xl border border-border bg-card p-3 text-[11px] flex flex-col items-start gap-1 hover:bg-muted/30"
          >
            <Download size={14} className="text-primary" />
            <span className="font-bold">Flow-Template</span>
            <span className="text-muted-foreground text-[10px]">
              Subflow-JSON für Node-RED, vorausgefüllt.
            </span>
          </a>
          <a
            href="https://github.com/BenjaminWie/pi-oasis/blob/main/docs/nodered-integration.md"
            target="_blank"
            rel="noreferrer"
            className="rounded-xl border border-border bg-card p-3 text-[11px] flex flex-col items-start gap-1 hover:bg-muted/30"
          >
            <ExternalLink size={14} className="text-primary" />
            <span className="font-bold">Doku</span>
            <span className="text-muted-foreground text-[10px]">
              Event-Payload, Strategy-Poll, Fallback.
            </span>
          </a>
        </div>
      </section>

      {/* Event payload example */}
      <section className="space-y-2">
        <h2 className="text-[10px] uppercase tracking-widest text-muted-foreground">
          Beispiel-Payload
        </h2>
        <pre className="rounded-xl border border-border bg-background p-3 text-[10px] font-mono overflow-x-auto">
{`POST {CLOUD_BRIDGE_URL}
Authorization: Bearer {CLOUD_DEVICE_TOKEN}

{
  "component": "tibber_pulse",
  "device": "drainpress",
  "status": "info",
  "metrics": { "watts": 412, "tibber_ct": 28 },
  "ts": "${new Date().toISOString()}"
}`}
        </pre>
        <pre className="rounded-xl border border-border bg-background p-3 text-[10px] font-mono overflow-x-auto">
{`GET {CLOUD_COMMAND_POLL_URL}
Authorization: Bearer {CLOUD_DEVICE_TOKEN}

// command.kind=plugin_manual -> cmnd/zisterne/POWER ON/OFF
// danach POST {CLOUD_COMMAND_RESULT_URL}`}
        </pre>
      </section>
    </div>
  );
}
