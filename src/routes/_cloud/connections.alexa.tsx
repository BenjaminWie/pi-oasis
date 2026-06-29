import { createFileRoute, Link } from "@tanstack/react-router";
import { Copy, Check, ExternalLink, Bot, Mic, ArrowLeft } from "lucide-react";
import { useState } from "react";

export const Route = createFileRoute("/_cloud/connections/alexa")({
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
        {
          "name": "StatusIntent",
          "samples": ["wie ist der status", "status", "system status"]
        },
        {
          "name": "PumpOnIntent",
          "slots": [{ "name": "minutes", "type": "AMAZON.NUMBER" }],
          "samples": [
            "Pumpe an",
            "Zisterne an",
            "Wasser an",
            "Pumpe an für {minutes} Minuten",
            "Zisterne an für {minutes} Minuten"
          ]
        },
        {
          "name": "PumpOffIntent",
          "samples": ["Pumpe aus", "Zisterne aus", "Wasser aus"]
        },
        {
          "name": "LaundryDoneIntent",
          "slots": [{ "name": "Appliance", "type": "AMAZON.SearchQuery" }],
          "samples": [
            "ist die Wäsche fertig",
            "ist meine Wäsche schon fertig",
            "läuft die Waschmaschine noch",
            "ist {Appliance} fertig"
          ]
        },
        {
          "name": "EnergyAskIntent",
          "samples": [
            "wie teuer ist Strom",
            "wie teuer ist Strom gerade",
            "Strompreis",
            "aktueller Strompreis"
          ]
        }
      ]
    }
  }
}`;

function AlexaPage() {
  const [copied, setCopied] = useState<string | null>(null);

  const origin =
    typeof window !== "undefined" ? window.location.origin : "https://pi-hub.benniwie.com";
  const alexaUrl = `${origin}/api/public/voice/alexa`;

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
    <div className="px-5 space-y-5">
      <Link
        to="/connections"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground mb-2"
      >
        <ArrowLeft size={14} /> zurück
      </Link>
      <div>
        <h2 className="text-xs uppercase tracking-widest text-muted-foreground mb-1 flex items-center gap-1.5">
          <Mic size={14} className="text-primary" /> Alexa Skill
        </h2>
        <p className="text-xs text-muted-foreground">
          Sprich mit deiner Pumpe — über jedes Alexa-Gerät.
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
            Sprache: <strong>Deutsch (DE)</strong>, Modell: <strong>Custom</strong>, Hosting:{" "}
            <strong>Provision your own</strong>.
          </p>
        </li>

        <li className="rounded-2xl border border-border bg-card p-4 space-y-3">
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-primary text-primary-foreground text-[10px] font-bold w-5 h-5 flex items-center justify-center">2</span>
            <span className="text-xs font-bold">Endpoint & Invocation</span>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Im Skill → <em>Endpoint</em> → HTTPS wählen, dann diese URL einfügen:
          </p>
          <CopyRow label="endpoint" value={alexaUrl} />
          <CopyRow label="invocation" value="pi hub" />
          <p className="text-[10px] text-muted-foreground">
            SSL-Zertifikat-Auswahl: <em>My development endpoint has a certificate from a trusted CA</em>.
          </p>
        </li>

        <li className="rounded-2xl border border-border bg-card p-4 space-y-3">
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-primary text-primary-foreground text-[10px] font-bold w-5 h-5 flex items-center justify-center">3</span>
            <span className="text-xs font-bold">Intent-Schema einfügen</span>
          </div>
          <p className="text-[11px] text-muted-foreground">
            JSON Editor → komplett ersetzen, Build Model klicken.
          </p>
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

        <li className="rounded-2xl border border-border bg-card p-4 space-y-3">
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-primary text-primary-foreground text-[10px] font-bold w-5 h-5 flex items-center justify-center">4</span>
            <span className="text-xs font-bold">Account Linking + Token</span>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Alexa nutzt MCP-Tokens als Bearer. Erzeuge ein Token mit{" "}
            <code className="text-primary">control</code>-Scope und nutze es als{" "}
            <em>Access Token</em> beim Skill-Test bzw. im Account-Linking-Flow.
          </p>
          <Link
            to="/connections/mcp"
            className="inline-flex items-center gap-2 rounded-lg bg-primary/10 text-primary border border-primary/20 px-3 py-2 text-xs font-bold uppercase tracking-widest"
          >
            <Bot size={14} /> MCP-Token erzeugen
          </Link>
          <a
            href="https://developer.amazon.com/de/docs/account-linking/configure-authorization-code-grant.html"
            target="_blank"
            rel="noreferrer"
            className="block text-[11px] text-primary inline-flex items-center gap-1"
          >
            Account Linking Doku <ExternalLink size={10} />
          </a>
        </li>

        <li className="rounded-2xl border border-border bg-card p-4 space-y-2">
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-primary text-primary-foreground text-[10px] font-bold w-5 h-5 flex items-center justify-center">5</span>
            <span className="text-xs font-bold">Testen</span>
          </div>
          <ul className="text-[11px] font-mono text-muted-foreground space-y-1">
            <li>"Alexa, frage Pi Hub nach dem Status."</li>
            <li>"Alexa, sage Pi Hub: Pumpe an für zehn Minuten."</li>
            <li>"Alexa, sage Pi Hub: Pumpe aus."</li>
          </ul>
        </li>
      </ol>
    </div>
  );
}
