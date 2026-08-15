// OAuth 2.0 Authorization endpoint for Alexa Account Linking — DATABASE-FREE.
//
// The consent page asks for the Pi link secret instead of a cloud account:
// whoever knows the Pi's token owns the Pi. Approving mints an HMAC-signed
// single-use code and redirects back to Alexa with ?code=&state=.

import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/api/public/oauth/authorize")({
  ssr: false,
  validateSearch: (s: Record<string, unknown>) => ({
    client_id: (s.client_id as string) ?? "",
    redirect_uri: (s.redirect_uri as string) ?? "",
    state: (s.state as string) ?? "",
    scope: (s.scope as string) ?? "control",
    response_type: (s.response_type as string) ?? "code",
  }),
  component: Consent,
});

function Consent() {
  const search = Route.useSearch();
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function approve(approved: boolean) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/public/oauth/authorize-post", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          approve: approved,
          client_id: search.client_id,
          redirect_uri: search.redirect_uri,
          state: search.state,
          scope: search.scope,
          link_secret: secret,
        }),
      });
      const j = await res.json();
      if (!res.ok || !j.redirect) throw new Error(j.error || `Fehler (${res.status})`);
      window.location.href = j.redirect;
    } catch (e: any) {
      setBusy(false);
      setError(String(e?.message ?? e));
    }
  }

  return (
    <main className="max-w-md mx-auto p-6 space-y-5">
      <div>
        <h1 className="text-lg font-semibold">Alexa mit Pi-Hub verknüpfen</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Alexa möchte deinen Pi-Hub steuern.
        </p>
      </div>

      <div className="rounded-xl border border-border bg-card p-4 text-sm space-y-3">
        <div>
          Rechte: <code className="text-primary">{search.scope}</code>
        </div>
        <label className="block space-y-1">
          <span className="text-xs uppercase tracking-widest text-muted-foreground">
            Link-Secret des Pi
          </span>
          <Input
            type="password"
            value={secret}
            autoComplete="off"
            onChange={(e) => setSecret(e.target.value)}
            placeholder="PIHUB_LINK_SECRET"
          />
        </label>
        <p className="text-xs text-muted-foreground pt-2 border-t border-border/50">
          Alexa kann damit Pumpe an/aus schalten, Status abfragen und MQTT-Kommandos
          im <code>cmnd/*</code>-Whitelist senden.
        </p>
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex gap-3">
        <Button onClick={() => approve(true)} disabled={busy || !secret} className="flex-1">
          {busy ? "…" : "Zustimmen"}
        </Button>
        <Button onClick={() => approve(false)} disabled={busy} variant="outline" className="flex-1">
          Ablehnen
        </Button>
      </div>
    </main>
  );
}
