// OAuth 2.0 Authorization Code endpoint for Alexa Account Linking.
//
// GET: verifies Supabase session, renders a small consent page.
// POST: on "Approve", mints a single-use code, stores its SHA-256 hash,
//       and 302-redirects back to Alexa's redirect_uri with ?code=&state=.
//
// The code is opaque; the client_id is validated against alexa_oauth_clients
// and the redirect_uri must be on the client's allowlist.

import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { getAlexaConsent } from "@/lib/alexa-oauth.functions";

type LoaderData = {
  clientName: string;
  clientId: string;
  redirectUri: string;
  scope: string;
  state: string;
  userEmail: string | null;
  deviceName: string | null;
};

export const Route = createFileRoute("/api/public/oauth/authorize")({
  ssr: false,
  validateSearch: (s: Record<string, unknown>) => ({
    client_id: (s.client_id as string) ?? "",
    redirect_uri: (s.redirect_uri as string) ?? "",
    state: (s.state as string) ?? "",
    scope: (s.scope as string) ?? "control",
    response_type: (s.response_type as string) ?? "code",
  }),
  beforeLoad: async ({ location }) => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      const next = location.pathname + location.searchStr;
      throw redirect({ to: "/auth", search: { next } as any });
    }
  },
  loader: async ({ location }) => {
    const params = new URLSearchParams(location.search);
    const result = await getAlexaConsent({
      data: {
        client_id: params.get("client_id") ?? "",
        redirect_uri: params.get("redirect_uri") ?? "",
        scope: params.get("scope") ?? "control",
        response_type: params.get("response_type") ?? "code",
      },
    });
    return { ...result, state: params.get("state") ?? "" } as LoaderData;
  },
  component: Consent,
  errorComponent: ({ error }) => (
    <main className="max-w-md mx-auto p-6 space-y-3">
      <h1 className="text-lg font-semibold">Verknüpfung fehlgeschlagen</h1>
      <p className="text-sm text-muted-foreground">
        {String((error as Error)?.message ?? error)}
      </p>
      <p className="text-xs text-muted-foreground">
        Prüfe in der Alexa Skill Konsole, dass Authorization URI, Client ID
        und Redirect URIs exakt so hinterlegt sind wie unter /connections/alexa gezeigt.
      </p>
    </main>
  ),
});

function Consent() {
  const data = Route.useLoaderData() as LoaderData;
  const search = Route.useSearch();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function approve(approved: boolean) {
    setBusy(true);
    setError(null);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) throw new Error("Bitte erneut anmelden.");
      const res = await fetch("/api/public/oauth/authorize", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          approve: approved,
          client_id: search.client_id,
          redirect_uri: search.redirect_uri,
          state: search.state,
          scope: search.scope,
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
          <strong>{data.clientName}</strong> möchte deinen Pi-Hub steuern.
        </p>
      </div>
      <div className="rounded-xl border border-border bg-card p-4 text-sm space-y-2">
        <div>
          Gerät: <strong>{data.deviceName ?? "—"}</strong>
        </div>
        <div>
          Rechte: <code className="text-primary">{data.scope}</code>
        </div>
        <div className="text-xs text-muted-foreground pt-2 border-t border-border/50">
          Alexa kann damit Pumpe an/aus schalten, Status abfragen und MQTT-Kommandos
          im <code>cmnd/*</code>-Whitelist senden. Deine App-Rechte bleiben unverändert.
        </div>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex gap-3">
        <Button onClick={() => approve(true)} disabled={busy} className="flex-1">
          {busy ? "…" : "Zustimmen"}
        </Button>
        <Button onClick={() => approve(false)} disabled={busy} variant="outline" className="flex-1">
          Ablehnen
        </Button>
      </div>
    </main>
  );
}
