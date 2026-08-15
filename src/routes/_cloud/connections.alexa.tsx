import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, XCircle, Copy } from "lucide-react";
import { getWiringStatus } from "@/lib/wiring.functions";

export const Route = createFileRoute("/_cloud/connections/alexa")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Alexa Skill verknüpfen — Pi Hub" },
      {
        name: "description",
        content:
          "Account Linking ohne Datenbank: signierte Tokens, Link-Secret als Nachweis, fertige URLs zum Kopieren.",
      },
      { property: "og:title", content: "Alexa Skill — Pi Hub" },
      { property: "og:description", content: "Zisterne per Sprache steuern, Account Linking in 5 Schritten." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AlexaPage,
});

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="flex items-center gap-2">
        <code className="flex-1 rounded-lg bg-background border border-border px-2 py-1.5 text-[10px] font-mono break-all">
          {value}
        </code>
        <button
          onClick={() => navigator.clipboard?.writeText(value)}
          aria-label={`${label} kopieren`}
          className="text-muted-foreground"
        >
          <Copy size={14} />
        </button>
      </div>
    </div>
  );
}

function AlexaPage() {
  const fn = useServerFn(getWiringStatus);
  const { data } = useQuery({ queryKey: ["wiring-status"], queryFn: () => fn() });
  const a = data?.alexa;

  const Flag = ({ ok }: { ok: boolean | undefined }) =>
    ok ? (
      <CheckCircle2 size={14} className="text-primary" />
    ) : (
      <XCircle size={14} className="text-destructive" />
    );

  return (
    <div className="px-5 space-y-4">
      <Link to="/connections" className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <ArrowLeft size={14} /> zurück
      </Link>

      <h2 className="text-xs uppercase tracking-widest text-muted-foreground">Alexa Skill</h2>

      <div className="rounded-2xl border border-border bg-card p-4 space-y-2 text-xs">
        <div className="flex items-center gap-2">
          <Flag ok={a?.clientConfigured} /> OAuth-Client (PIHUB_OAUTH_CLIENT_ID / _SECRET)
        </div>
        <div className="flex items-center gap-2">
          <Flag ok={a?.linkSecretSet} /> Link-Secret (PIHUB_LINK_SECRET)
        </div>
        <div className="flex items-center gap-2">
          <Flag ok={a?.tokenSecretSet} /> Token-Signatur (PIHUB_TOKEN_SECRET)
        </div>
        <p className="text-[10px] text-muted-foreground leading-relaxed pt-1">
          Es wird nichts gespeichert: Codes und Tokens sind HMAC-signiert. Zurückziehen = Secret
          rotieren.
        </p>
      </div>

      {a && (
        <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
          <h3 className="text-xs uppercase tracking-widest text-muted-foreground">
            Werte für die Alexa Developer Console
          </h3>
          <Field label="Web Authorization URI" value={a.authorizeUrl} />
          <Field label="Access Token URI" value={a.tokenUrl} />
          <Field label="Client ID" value={a.clientConfigured ? "= PIHUB_OAUTH_CLIENT_ID" : "noch nicht gesetzt"} />
          <Field label="Client Secret" value={a.clientConfigured ? "= PIHUB_OAUTH_CLIENT_SECRET" : "noch nicht gesetzt"} />
          <Field label="Scope" value="read control" />
          <Field label="Skill Endpoint (HTTPS)" value={a.skillEndpoint} />
          {a.extraRedirectUris.length > 0 && (
            <Field label="Zusätzliche Redirect-URIs" value={a.extraRedirectUris.join(", ")} />
          )}
        </div>
      )}

      <div className="rounded-2xl border border-border bg-card/60 p-4 text-[11px] text-muted-foreground leading-relaxed space-y-2">
        <p className="font-bold text-foreground">So verknüpfst du</p>
        <ol className="space-y-1 list-decimal list-inside">
          <li>Secrets setzen: Client-ID, Client-Secret, Link-Secret, Token-Secret.</li>
          <li>In der Alexa Console „Account Linking" → Auth Code Grant, obige URLs eintragen.</li>
          <li>
            Alexa zeigt dir Redirect-URIs (amazon.com / amazonalexa.com). Diese sind erlaubt; andere
            Hosts über <code>PIHUB_OAUTH_REDIRECT_URIS</code> ergänzen.
          </li>
          <li>In der Alexa-App den Skill aktivieren → Consent-Seite fragt nach dem Link-Secret.</li>
          <li>„Alexa, sage Pi Hub: Zisterne an für 10 Minuten."</li>
        </ol>
        <p>
          Fehler beim Verknüpfen? Prüfe auf der{" "}
          <Link to="/connections/setup" className="text-primary">
            Verkabelungs-Seite
          </Link>
          , ob Relay und Secrets grün sind.
        </p>
      </div>
    </div>
  );
}
