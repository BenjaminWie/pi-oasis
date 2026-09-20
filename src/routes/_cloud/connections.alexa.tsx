import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ArrowLeft, CheckCircle2, XCircle, Copy, Download, Play } from "lucide-react";
import { alexaSelftest, getAlexaModelJson, getWiringStatus, type SelftestStep } from "@/lib/wiring.functions";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_cloud/connections/alexa")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Alexa Skill verknüpfen — Pi Hub" },
      {
        name: "description",
        content:
          "Account Linking ohne Datenbank: signierte Tokens, Link-Secret als Nachweis, fertige URLs und Sprachmodell zum Download.",
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

function Flag({ ok }: { ok: boolean | undefined }) {
  return ok ? (
    <CheckCircle2 size={14} className="text-primary" />
  ) : (
    <XCircle size={14} className="text-destructive" />
  );
}

function AlexaPage() {
  const fn = useServerFn(getWiringStatus);
  const testFn = useServerFn(alexaSelftest);
  const modelFn = useServerFn(getAlexaModelJson);
  const { data } = useQuery({ queryKey: ["wiring-status"], queryFn: () => fn() });
  const a = data?.alexa;
  const [steps, setSteps] = useState<SelftestStep[] | null>(null);

  const test = useMutation({
    mutationFn: () => testFn(),
    onSuccess: (r) => setSteps(r.steps),
    onError: (e: Error) => setSteps([{ name: "Test", ok: false, info: e.message }]),
  });

  const download = useMutation({
    mutationFn: () => modelFn(),
    onSuccess: (r) => {
      const url = URL.createObjectURL(new Blob([r.json], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = "pi-control-alexa-de-DE.json";
      link.click();
      URL.revokeObjectURL(url);
    },
  });

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
        <div className="flex items-center gap-2">
          <Flag ok={a?.skillIdSet} /> Skill-Kennung (PIHUB_ALEXA_SKILL_ID, optional aber empfohlen)
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

      <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
        <h3 className="text-xs uppercase tracking-widest text-muted-foreground">
          Sprachmodell & Test
        </h3>
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          Das deutsche Sprachmodell wird aus den aktuell angemeldeten Endpunkten gebaut — neue
          Schalter kann Alexa nach einem neuen Download sofort ansprechen.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => download.mutate()} disabled={download.isPending}>
            <Download size={14} className="mr-1" />
            {download.isPending ? "…" : "Sprachmodell (de-DE)"}
          </Button>
          <Button size="sm" onClick={() => test.mutate()} disabled={test.isPending}>
            <Play size={14} className="mr-1" />
            {test.isPending ? "Teste…" : "Kette testen"}
          </Button>
        </div>
        {steps && (
          <ul className="space-y-1.5 pt-1">
            {steps.map((s) => (
              <li key={s.name} className="flex items-start gap-2 text-[11px]">
                <span className="pt-0.5">
                  <Flag ok={s.ok} />
                </span>
                <span>
                  <span className="font-bold">{s.name}</span>{" "}
                  <span className="text-muted-foreground">{s.info}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-2xl border border-border bg-card/60 p-4 text-[11px] text-muted-foreground leading-relaxed space-y-2">
        <p className="font-bold text-foreground">So verknüpfst du</p>
        <ol className="space-y-1 list-decimal list-inside">
          <li>Secrets setzen: Client-ID, Client-Secret, Link-Secret, Token-Secret.</li>
          <li>In der Alexa Console „Account Linking" → Auth Code Grant, obige URLs eintragen.</li>
          <li>Sprachmodell herunterladen und im Tab „JSON Editor" der Console einfügen, dann bauen.</li>
          <li>
            Alexa zeigt dir Redirect-URIs (amazon.com / amazonalexa.com). Diese sind erlaubt; andere
            Hosts über <code>PIHUB_OAUTH_REDIRECT_URIS</code> ergänzen.
          </li>
          <li>In der Alexa-App den Skill aktivieren → Consent-Seite fragt nach dem Link-Secret.</li>
          <li>„Alexa, sage Pi Control: bewässere zehn Minuten."</li>
        </ol>
        <p>
          Fehler beim Verknüpfen? Prüfe auf der{" "}
          <Link to="/connections/setup" className="text-primary">
            Verkabelungs-Seite
          </Link>
          , ob Relay und Secrets grün sind — Details stehen im Debug-Kanal „alexa".
        </p>
      </div>
    </div>
  );
}
