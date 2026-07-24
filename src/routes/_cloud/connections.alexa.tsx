import { createFileRoute, Link } from "@tanstack/react-router";
import { Copy, Check, ExternalLink, Mic, ArrowLeft, KeyRound, Trash2, Plus, X } from "lucide-react";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  listAlexaClients,
  createAlexaClient,
  deleteAlexaClient,
  updateAlexaClientRedirectUris,
} from "@/lib/alexa-oauth.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

export const Route = createFileRoute("/_cloud/connections/alexa")({
  validateSearch: (s: Record<string, unknown>) => ({
    highlight: typeof s.highlight === "string" ? s.highlight : undefined,
    suggest: typeof s.suggest === "string" ? s.suggest : undefined,
  }),
  component: AlexaPage,
});

const INTENT_SCHEMA = `{
  "interactionModel": {
    "languageModel": {
      "invocationName": "pi hub",
      "intents": [
        { "name": "AMAZON.StopIntent" },
        { "name": "AMAZON.HelpIntent" },
        { "name": "AMAZON.CancelIntent" },
        { "name": "StatusIntent",
          "samples": ["wie ist der status", "status", "system status"] },
        { "name": "PumpOnIntent",
          "slots": [{ "name": "Minutes", "type": "AMAZON.NUMBER" }],
          "samples": [
            "Pumpe an", "Zisterne an", "Wasser an",
            "Pumpe an für {Minutes} Minuten",
            "Zisterne an für {Minutes} Minuten"
          ] },
        { "name": "PumpOffIntent",
          "samples": ["Pumpe aus", "Zisterne aus", "Wasser aus"] },
        { "name": "LaundryDoneIntent",
          "slots": [{ "name": "Appliance", "type": "AMAZON.SearchQuery" }],
          "samples": ["ist die Wäsche fertig", "ist meine Wäsche schon fertig",
                      "läuft die Waschmaschine noch", "ist {Appliance} fertig"] },
        { "name": "EnergyAskIntent",
          "samples": ["wie teuer ist Strom", "wie teuer ist Strom gerade",
                      "Strompreis", "aktueller Strompreis"] }
      ]
    }
  }
}`;

function AlexaPage() {
  const [copied, setCopied] = useState<string | null>(null);
  const [freshSecret, setFreshSecret] = useState<{ client_id: string; client_secret: string } | null>(null);

  const list = useServerFn(listAlexaClients);
  const create = useServerFn(createAlexaClient);
  const del = useServerFn(deleteAlexaClient);
  const qc = useQueryClient();

  const clients = useQuery({
    queryKey: ["alexa-clients"],
    queryFn: () => list(),
  });

  const createMut = useMutation({
    mutationFn: () => create({ data: { name: "Alexa Skill" } }),
    onSuccess: (data) => {
      setFreshSecret(data);
      qc.invalidateQueries({ queryKey: ["alexa-clients"] });
      toast.success("Credentials erzeugt — Secret nur JETZT sichtbar!");
    },
    onError: (e: any) => toast.error(String(e?.message ?? e)),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => del({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["alexa-clients"] });
      toast.success("Client widerrufen");
    },
  });

  const origin =
    typeof window !== "undefined" ? window.location.origin : "https://pi-hub.benniwie.com";
  const authUrl = `${origin}/api/public/oauth/authorize`;
  const tokenUrl = `${origin}/api/public/oauth/token`;
  const skillEndpoint = `${origin}/api/public/voice/alexa`;

  function copy(label: string, text: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(label);
      setTimeout(() => setCopied(null), 1500);
    });
  }

  function CopyRow({ label, value }: { label: string; value: string }) {
    return (
      <div className="rounded-xl border border-border bg-background p-3">
        <div className="text-[9px] uppercase tracking-widest text-muted-foreground mb-1">
          {label}
        </div>
        <div className="flex items-center justify-between gap-2">
          <code className="font-mono text-[11px] break-all">{value}</code>
          <button onClick={() => copy(label, value)} className="text-primary shrink-0">
            {copied === label ? <Check size={14} /> : <Copy size={14} />}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="px-5 space-y-5 pb-8">
      <Link
        to="/connections"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground mb-2"
      >
        <ArrowLeft size={14} /> zurück
      </Link>
      <div>
        <h2 className="text-xs uppercase tracking-widest text-muted-foreground mb-1 flex items-center gap-1.5">
          <Mic size={14} className="text-primary" /> Alexa Skill (OAuth 2.0)
        </h2>
        <p className="text-xs text-muted-foreground">
          Sprich mit deiner Pumpe — über jedes Alexa-Gerät. Echtes Account Linking mit Authorization Code Grant.
        </p>
      </div>

      <ol className="space-y-3">
        <li className="rounded-2xl border border-border bg-card p-4 space-y-2">
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-primary text-primary-foreground text-[10px] font-bold w-5 h-5 flex items-center justify-center">1</span>
            <span className="text-xs font-bold">Custom Skill anlegen</span>
          </div>
          <a
            href="https://developer.amazon.com/alexa/console/ask"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-primary"
          >
            Alexa Developer Console öffnen <ExternalLink size={11} />
          </a>
          <p className="text-[11px] text-muted-foreground">
            Sprache <strong>Deutsch (DE)</strong>, Modell <strong>Custom</strong>, Hosting{" "}
            <strong>Provision your own</strong>. Invocation-Name: <code>pi hub</code> (muss exakt zum Skill passen).
          </p>
        </li>

        <li className="rounded-2xl border border-border bg-card p-4 space-y-3">
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-primary text-primary-foreground text-[10px] font-bold w-5 h-5 flex items-center justify-center">2</span>
            <span className="text-xs font-bold">Client-Credentials erzeugen</span>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Jeder Skill bekommt eigene Zugangsdaten. Das <strong>Client Secret</strong> wird nur EINMAL angezeigt.
          </p>
          <Button
            onClick={() => createMut.mutate()}
            disabled={createMut.isPending}
            className="w-full"
            size="sm"
          >
            <KeyRound size={14} className="mr-1.5" />
            {createMut.isPending ? "erzeuge…" : "Neue Credentials erzeugen"}
          </Button>

          {freshSecret && (
            <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 space-y-2">
              <div className="text-[10px] text-primary uppercase tracking-widest font-bold">
                Jetzt kopieren – wird nicht wieder angezeigt!
              </div>
              <CopyRow label="client_id" value={freshSecret.client_id} />
              <CopyRow label="client_secret" value={freshSecret.client_secret} />
            </div>
          )}

          {clients.data && clients.data.length > 0 && (
            <div className="space-y-1.5 pt-2 border-t border-border">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                Aktive Clients
              </div>
              {clients.data.map((c: any) => (
                <div key={c.id} className="flex items-center justify-between text-[11px] font-mono">
                  <span className="truncate">{c.client_id}</span>
                  <button
                    onClick={() => deleteMut.mutate(c.id)}
                    className="text-destructive p-1"
                    aria-label="widerrufen"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </li>

        <li className="rounded-2xl border border-border bg-card p-4 space-y-3">
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-primary text-primary-foreground text-[10px] font-bold w-5 h-5 flex items-center justify-center">3</span>
            <span className="text-xs font-bold">Account Linking konfigurieren</span>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Im Skill → <em>Account Linking</em> → <strong>Auth Code Grant</strong> wählen und diese Werte eintragen:
          </p>
          <CopyRow label="Authorization URI" value={authUrl} />
          <CopyRow label="Access Token URI" value={tokenUrl} />
          <CopyRow label="Client ID" value={freshSecret?.client_id ?? "(aus Schritt 2)"} />
          <CopyRow label="Client Secret" value={freshSecret?.client_secret ?? "(aus Schritt 2)"} />
          <CopyRow label="Client Authentication Scheme" value="HTTP Basic (Recommended)" />
          <CopyRow label="Scope" value="control" />
          <p className="text-[10px] text-muted-foreground">
            Die drei Alexa Redirect URLs (layla.amazon.com / alexa.amazon.co.jp / pitangui.amazon.com)
            werden von Alexa selbst angezeigt und sind bereits in unserer Allowlist eingetragen.
          </p>
        </li>

        <li className="rounded-2xl border border-border bg-card p-4 space-y-3">
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-primary text-primary-foreground text-[10px] font-bold w-5 h-5 flex items-center justify-center">4</span>
            <span className="text-xs font-bold">Endpoint & Intent Schema</span>
          </div>
          <CopyRow label="HTTPS Endpoint" value={skillEndpoint} />
          <div className="relative">
            <pre className="rounded-xl border border-border bg-background p-3 text-[10px] font-mono overflow-x-auto max-h-60">
{INTENT_SCHEMA}
            </pre>
            <button
              onClick={() => copy("schema", INTENT_SCHEMA)}
              className="absolute top-2 right-2 text-primary bg-card border border-border rounded p-1.5"
            >
              {copied === "schema" ? <Check size={12} /> : <Copy size={12} />}
            </button>
          </div>
        </li>

        <li className="rounded-2xl border border-border bg-card p-4 space-y-2">
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-primary text-primary-foreground text-[10px] font-bold w-5 h-5 flex items-center justify-center">5</span>
            <span className="text-xs font-bold">Verlinken & testen</span>
          </div>
          <p className="text-[11px] text-muted-foreground">
            In der Alexa-App: Skills → dein Skill → <strong>Zum Aktivieren tippen</strong>.
            Du landest auf Pi-Hub, meldest dich mit Google an und stimmst zu — fertig.
          </p>
          <ul className="text-[11px] font-mono text-muted-foreground space-y-1 pt-2">
            <li>"Alexa, frage Pi Hub nach dem Status."</li>
            <li>"Alexa, sage Pi Hub: Pumpe an für zehn Minuten."</li>
            <li>"Alexa, sage Pi Hub: Pumpe aus."</li>
          </ul>
        </li>
      </ol>
    </div>
  );
}
