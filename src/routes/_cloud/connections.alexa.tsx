import { createFileRoute } from "@tanstack/react-router";
import { Copy, Check, ExternalLink } from "lucide-react";
import { useState } from "react";

export const Route = createFileRoute("/_cloud/connections/alexa")({
  component: AlexaPage,
});

function AlexaPage() {
  const [copied, setCopied] = useState<string | null>(null);

  const origin = typeof window !== "undefined" ? window.location.origin : "https://pi-hub.benniwie.com";
  const alexaUrl = `${origin}/api/public/voice/alexa`;

  function copy(label: string, text: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(label);
      setTimeout(() => setCopied(null), 1500);
    });
  }

  return (
    <div className="px-5 space-y-6">
      <div>
        <h2 className="text-xs uppercase tracking-widest text-muted-foreground mb-1">
          Alexa Skill
        </h2>
        <p className="text-xs text-muted-foreground">
          Steuere deinen Pi mit Amazon Alexa Sprachbefehlen.
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-card p-4 space-y-4">
        <div className="space-y-2">
          <h3 className="text-xs font-bold uppercase tracking-widest">Setup Anleitung</h3>
          <ol className="text-xs space-y-3 text-muted-foreground list-decimal list-inside">
            <li>
              Erstelle einen <strong>Custom Skill</strong> in der{" "}
              <a
                href="https://developer.amazon.com/alexa/console/ask"
                target="_blank"
                rel="noreferrer"
                className="text-primary inline-flex items-center gap-0.5"
              >
                Alexa Developer Console <ExternalLink size={10} />
              </a>
            </li>
            <li>
              Wähle <strong>HTTPS</strong> als Endpoint und füge diese URL ein:
              <div className="mt-2 rounded-xl border border-border bg-background p-3 font-mono text-[10px] break-all flex items-center justify-between gap-2">
                <span>{alexaUrl}</span>
                <button onClick={() => copy("url", alexaUrl)} className="text-primary shrink-0">
                  {copied === "url" ? <Check size={14} /> : <Copy size={14} />}
                </button>
              </div>
            </li>
            <li>
              Aktiviere <strong>Account Linking</strong>.
            </li>
            <li>
              Verwende ein <strong>MCP Token</strong> mit <code className="text-primary">control</code> Scope als Bearer Token für den Skill.
            </li>
          </ol>
        </div>

        <div className="pt-2">
          <h3 className="text-xs font-bold uppercase tracking-widest mb-2">Beispielbefehle</h3>
          <ul className="text-xs space-y-1 font-mono text-muted-foreground">
            <li>"Alexa, frage Pi Hub nach dem Status"</li>
            <li>"Alexa, sage Pi Hub: Gartenpumpe an"</li>
            <li>"Alexa, frage Pi Hub: Wie ist der Plan?"</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
