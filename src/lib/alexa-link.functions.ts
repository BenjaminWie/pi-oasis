// Public server function behind the Alexa consent page.
// It validates the incoming OAuth request BEFORE the user is asked for the link
// secret, so Alexa shows a readable German message instead of a technical error.

import { createServerFn } from "@tanstack/react-start";

export interface AuthorizeCheck {
  ok: boolean;
  /** human readable reason when ok === false */
  error?: string;
  scope: string;
  /** is the Pi currently answering through the relay? */
  piOnline: boolean;
  piStale: boolean;
  piConfigured: boolean;
  deviceLabel: string;
}

export const checkAuthorizeRequest = createServerFn({ method: "GET" })
  .inputValidator((input: { client_id?: string; redirect_uri?: string; response_type?: string; scope?: string }) => input)
  .handler(async ({ data }): Promise<AuthorizeCheck> => {
    const { oauthClient } = await import("@/lib/stateless-token.server");
    const { isRedirectAllowed } = await import("@/lib/oauth-redirect");
    const { normalizeScope } = await import("@/lib/oauth-scope");
    const { piConfig, getPiState } = await import("@/lib/pi-relay.server");

    const scope = normalizeScope(data.scope);
    const pi = piConfig();
    const label = process.env.DEFAULT_DEVICE_LABEL || "Pi Control";
    const base: AuthorizeCheck = {
      ok: false,
      scope,
      piOnline: false,
      piStale: false,
      piConfigured: pi.configured,
      deviceLabel: label,
    };

    const client = oauthClient();
    if (!client.configured) {
      return { ...base, error: "Auf diesem Server ist noch kein Alexa-Zugang eingerichtet." };
    }
    if ((data.response_type ?? "code") !== "code") {
      return { ...base, error: "Diese Art der Anmeldung wird nicht unterstützt." };
    }
    if (!data.client_id || data.client_id !== client.id) {
      return { ...base, error: "Diese Skill-Kennung gehört nicht zu diesem Pi." };
    }
    if (!data.redirect_uri || !isRedirectAllowed(data.redirect_uri)) {
      return { ...base, error: "Die Rücksprung-Adresse von Alexa ist nicht freigegeben." };
    }
    if (!(process.env.PIHUB_LINK_SECRET || process.env.PIHUB_DEVICE_TOKEN)) {
      return { ...base, error: "Es ist kein Link-Geheimwort gesetzt." };
    }

    if (pi.configured) {
      const probe = await getPiState();
      base.piOnline = Boolean(probe.ok && !probe.stale);
      base.piStale = Boolean(probe.stale);
    } else {
      base.piOnline = true; // running directly on the Pi
    }

    return { ...base, ok: true };
  });
