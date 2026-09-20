// OAuth 2.0 Authorization endpoint for Alexa Account Linking — DATABASE-FREE.
//
// The request is validated on the server first (loader), so Alexa's webview
// shows a readable German message instead of a technical error. The consent page
// asks for the Pi link secret instead of a cloud account: whoever knows the Pi's
// token owns the Pi. Approving mints an HMAC-signed short-lived code and
// redirects back to Alexa with ?code=&state=.

import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AlertTriangle, CheckCircle2, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { checkAuthorizeRequest } from "@/lib/alexa-link.functions";

export const Route = createFileRoute("/api/public/oauth/authorize")({
  // Keep the search object identical to the incoming URL — adding defaults here
  // makes the router redirect, which Alexa's webview reports as a link failure.
  validateSearch: (s: Record<string, unknown>) => ({
    client_id: s.client_id as string | undefined,
    redirect_uri: s.redirect_uri as string | undefined,
    state: s.state as string | undefined,
    scope: s.scope as string | undefined,
    response_type: s.response_type as string | undefined,
  }),
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) =>
    checkAuthorizeRequest({
      data: {
        client_id: deps.client_id,
        redirect_uri: deps.redirect_uri,
        response_type: deps.response_type,
        scope: deps.scope,
      },
    }),
  errorComponent: () => (
    <main className="max-w-md mx-auto p-6">
      <p className="text-sm text-destructive">
        Die Verknüpfung konnte nicht geprüft werden. Bitte später erneut versuchen.
      </p>
    </main>
  ),
  notFoundComponent: () => (
    <main className="max-w-md mx-auto p-6">
      <p className="text-sm text-muted-foreground">Seite nicht gefunden.</p>
    </main>
  ),
  head: () => ({
    meta: [
      { title: "Alexa verknüpfen — Pi Control" },
      {
        name: "description",
        content: "Zustimmung für die Alexa-Verknüpfung mit deinem Pi Control.",
      },
      { property: "og:title", content: "Alexa verknüpfen — Pi Control" },
      { property: "og:description", content: "Zustimmung für die Alexa-Verknüpfung." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Consent,
});

function Consent() {
  const search = Route.useSearch();
  const check = Route.useLoaderData();
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
          scope: check.scope,
          link_secret: secret,
        }),
      });
      const j = (await res.json()) as { redirect?: string; error?: string };
      if (!res.ok || !j.redirect) throw new Error(j.error || `Fehler (${res.status})`);
      window.location.href = j.redirect;
    } catch (e: unknown) {
      setBusy(false);
      setError(String((e as Error)?.message ?? e));
    }
  }

  if (!check.ok) {
    return (
      <main className="max-w-md mx-auto p-6 space-y-4">
        <h1 className="text-lg font-semibold">Verknüpfung nicht möglich</h1>
        <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm flex gap-2">
          <AlertTriangle size={16} className="text-destructive shrink-0 mt-0.5" />
          <span>{check.error}</span>
        </div>
        <p className="text-xs text-muted-foreground">
          Prüfe in Pi Control unter Verbindungen → Alexa, ob alle Werte gesetzt sind, und starte die
          Verknüpfung in der Alexa-App dann neu.
        </p>
      </main>
    );
  }

  return (
    <main className="max-w-md mx-auto p-6 space-y-5">
      <div>
        <h1 className="text-lg font-semibold">Alexa mit {check.deviceLabel} verknüpfen</h1>
        <p className="text-sm text-muted-foreground mt-1">Alexa möchte deinen Pi steuern.</p>
      </div>

      <div className="rounded-xl border border-border bg-card p-4 text-sm space-y-3">
        <div className="flex items-center gap-2 text-xs">
          {check.piOnline ? (
            <>
              <CheckCircle2 size={14} className="text-primary" />
              <span className="text-muted-foreground">
                Pi erreichbar{check.piStale ? " (letzte Daten etwas älter)" : ""}
              </span>
            </>
          ) : (
            <>
              <WifiOff size={14} className="text-destructive" />
              <span className="text-muted-foreground">
                Pi antwortet gerade nicht — Verknüpfen geht trotzdem.
              </span>
            </>
          )}
        </div>
        <div>
          Rechte: <code className="text-primary">{check.scope}</code>
        </div>
        <label className="block space-y-1">
          <span className="text-xs uppercase tracking-widest text-muted-foreground">
            Link-Geheimwort des Pi
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
          Alexa kann damit die angemeldeten Endpunkte schalten und Werte abfragen.
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
