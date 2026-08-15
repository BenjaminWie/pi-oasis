import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, XCircle, AlertTriangle, RefreshCw } from "lucide-react";
import { getWiringStatus } from "@/lib/wiring.functions";

export const Route = createFileRoute("/_cloud/connections/setup")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Verkabelung — Pi Hub Cloud Relay" },
      {
        name: "description",
        content:
          "Status von Relay, Telegram, Alexa und Node-RED: welche Werte gesetzt sind und was noch fehlt.",
      },
      { property: "og:title", content: "Pi Hub Verkabelung" },
      { property: "og:description", content: "Ein Blick: Relay, Telegram, Alexa, Node-RED." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SetupPage,
});

function Row({ ok, label, hint }: { ok: boolean | null; label: string; hint?: string | null }) {
  const Icon = ok === true ? CheckCircle2 : ok === null ? AlertTriangle : XCircle;
  const color =
    ok === true ? "text-primary" : ok === null ? "text-yellow-500" : "text-destructive";
  return (
    <div className="flex items-start gap-2 py-1.5">
      <Icon size={14} className={`mt-0.5 shrink-0 ${color}`} />
      <div className="min-w-0">
        <div className="text-xs">{label}</div>
        {hint && <div className="text-[10px] font-mono text-muted-foreground break-all">{hint}</div>}
      </div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <h3 className="text-xs uppercase tracking-widest text-muted-foreground mb-2">{title}</h3>
      {children}
    </section>
  );
}

function SetupPage() {
  const fn = useServerFn(getWiringStatus);
  const { data, isFetching, refetch, error } = useQuery({
    queryKey: ["wiring-status"],
    queryFn: () => fn(),
    staleTime: 30_000,
  });

  return (
    <div className="px-5 space-y-4">
      <Link
        to="/connections"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground"
      >
        <ArrowLeft size={14} /> zurück
      </Link>

      <div className="flex items-center justify-between">
        <h2 className="text-xs uppercase tracking-widest text-muted-foreground">Verkabelung</h2>
        <button
          onClick={() => refetch()}
          className="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest text-muted-foreground"
        >
          <RefreshCw size={12} className={isFetching ? "animate-spin" : ""} /> prüfen
        </button>
      </div>

      {error && (
        <p className="text-xs text-destructive">
          Status konnte nicht geladen werden: {String((error as Error).message)}
        </p>
      )}
      {!data && !error && <p className="text-xs text-muted-foreground">Prüfe Verbindungen…</p>}

      {data && (
        <div className="space-y-3">
          <Card title="1 · Relay zum Pi">
            <Row
              ok={data.relay.configured}
              label="PIHUB_PI_URL + PIHUB_DEVICE_TOKEN gesetzt"
              hint={data.relay.piUrl}
            />
            <Row
              ok={data.relay.online ? true : data.relay.stale ? null : false}
              label={
                data.relay.online
                  ? "Pi antwortet live"
                  : data.relay.stale
                    ? `Pi still — zeige Cache (${data.relay.ageSec}s alt)`
                    : "Pi nicht erreichbar"
              }
              hint={data.relay.error ?? null}
            />
            <p className="text-[10px] text-muted-foreground mt-2 leading-relaxed">
              Auf dem Pi: <code>scripts/install-tunnel.sh</code> ausführen, die Tunnel-URL als{" "}
              <code>PIHUB_PI_URL</code> und das <code>PI_INGEST_TOKEN</code> als{" "}
              <code>PIHUB_DEVICE_TOKEN</code> hier hinterlegen.
            </p>
          </Card>

          <Card title="2 · Telegram">
            <Row ok={data.telegram.configured} label="PIHUB_TELEGRAM_BOT_TOKEN gesetzt" hint={data.telegram.botUsername ? `@${data.telegram.botUsername}` : null} />
            <Row ok={data.telegram.secretSet} label="PIHUB_TELEGRAM_WEBHOOK_SECRET gesetzt" />
            <Row
              ok={data.telegram.webhookOk}
              label="Webhook zeigt auf diese Instanz"
              hint={data.telegram.webhookUrl}
            />
            <Row
              ok={data.telegram.chatAllowlist > 0 ? true : null}
              label={
                data.telegram.chatAllowlist > 0
                  ? `${data.telegram.chatAllowlist} Chat-ID(s) dauerhaft freigegeben`
                  : "Keine dauerhafte Chat-Freigabe — /link nutzen"
              }
            />
            <Link
              to="/connections/telegram"
              className="mt-2 inline-block text-[10px] uppercase tracking-widest text-primary"
            >
              Telegram einrichten →
            </Link>
          </Card>

          <Card title="3 · Alexa">
            <Row ok={data.alexa.clientConfigured} label="PIHUB_OAUTH_CLIENT_ID/SECRET gesetzt" />
            <Row ok={data.alexa.linkSecretSet} label="PIHUB_LINK_SECRET gesetzt (Consent-Nachweis)" />
            <Row ok={data.alexa.tokenSecretSet} label="PIHUB_TOKEN_SECRET gesetzt (Token-Signatur)" />
            <Row ok={true} label="Authorization URI" hint={data.alexa.authorizeUrl} />
            <Row ok={true} label="Access Token URI" hint={data.alexa.tokenUrl} />
            <Row ok={true} label="Skill Endpoint" hint={data.alexa.skillEndpoint} />
            <Link
              to="/connections/alexa"
              className="mt-2 inline-block text-[10px] uppercase tracking-widest text-primary"
            >
              Alexa Schritt für Schritt →
            </Link>
          </Card>

          <Card title="4 · Node-RED">
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Node-RED holt sich alles vom Pi selbst — kein Copy-Paste. Auf der Pi-Oberfläche unter{" "}
              <code>/integrations</code> den personalisierten Flow herunterladen, in Node-RED
              importieren, Deploy drücken und den Selftest starten.
            </p>
            <p className="text-[10px] text-muted-foreground mt-2 font-mono break-all">
              {data.relay.piUrl ?? "http://<pi-ip>:3000"}/integrations
            </p>
          </Card>

          <Card title="5 · Assistent">
            <Row ok={data.ai.gatewayKeySet} label="LOVABLE_API_KEY gesetzt (AI Gateway)" />
            <Row
              ok={data.relay.configured}
              label="Tools erreichen den Pi über das Relay"
            />
          </Card>
        </div>
      )}
    </div>
  );
}
