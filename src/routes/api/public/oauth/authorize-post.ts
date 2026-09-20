// Server-side companion to authorize.tsx — DATABASE-FREE consent leg.
//
// Ownership is proven with the Pi link secret (PIHUB_LINK_SECRET, falling back
// to PIHUB_DEVICE_TOKEN) instead of a Supabase session, and the approved code
// is an HMAC-signed, self-describing token — nothing is stored anywhere.

import { createFileRoute } from "@tanstack/react-router";
import { randomBytes, timingSafeEqual } from "crypto";
import { jsonResponse } from "@/lib/agent-api.server";
import { normalizeScope } from "@/lib/oauth-scope";
import { isRedirectAllowed } from "@/lib/oauth-redirect";
import { issueToken, oauthClient } from "@/lib/stateless-token.server";

/** Alexa redeems the code within seconds; a short window limits replay. */
const CODE_TTL_SEC = 60;

export { isRedirectAllowed };

function safeEqual(a: string, b: string) {
  const A = Buffer.from(a);
  const B = Buffer.from(b);
  return A.length === B.length && timingSafeEqual(A, B);
}

function linkSecret() {
  return process.env.PIHUB_LINK_SECRET || process.env.PIHUB_DEVICE_TOKEN || "";
}

async function log(dir: "in" | "out" | "error", what: string, detail?: unknown) {
  try {
    const { debugLog } = await import("@/lib/registry.server");
    debugLog(dir, what, detail, "alexa");
  } catch {
    /* logging is best effort */
  }
}

export const Route = createFileRoute("/api/public/oauth/authorize-post")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = (await request.json().catch(() => ({}))) as {
          approve?: boolean;
          client_id?: string;
          redirect_uri?: string;
          state?: string;
          scope?: string;
          link_secret?: string;
        };

        if (!body.client_id || !body.redirect_uri) {
          await log("error", "Verknüpfung: Parameter fehlen");
          return jsonResponse({ error: "missing params" }, 400);
        }

        const client = oauthClient();
        if (!client.configured) {
          await log("error", "Verknüpfung: OAuth-Client nicht konfiguriert");
          return jsonResponse({ error: "OAuth ist auf diesem Server nicht konfiguriert." }, 500);
        }
        if (!safeEqual(body.client_id, client.id)) {
          await log("error", "Verknüpfung: unbekannte Client-ID");
          return jsonResponse({ error: "unbekannte Client-ID" }, 403);
        }
        if (!isRedirectAllowed(body.redirect_uri)) {
          await log("error", "Verknüpfung: redirect_uri nicht erlaubt", { uri: body.redirect_uri });
          return jsonResponse({ error: `redirect_uri nicht erlaubt: ${body.redirect_uri}` }, 400);
        }

        const secret = linkSecret();
        if (!secret) {
          await log("error", "Verknüpfung: kein Link-Secret gesetzt");
          return jsonResponse({ error: "Kein Link-Secret gesetzt (PIHUB_LINK_SECRET)." }, 500);
        }
        if (!body.link_secret || !safeEqual(body.link_secret, secret)) {
          await log("error", "Verknüpfung: falsches Link-Secret");
          return jsonResponse({ error: "Falsches Link-Secret." }, 401);
        }

        const u = new URL(body.redirect_uri);
        if (!body.approve) {
          u.searchParams.set("error", "access_denied");
          if (body.state) u.searchParams.set("state", body.state);
          await log("out", "Verknüpfung abgelehnt");
          return jsonResponse({ redirect: u.toString() });
        }

        const scope = normalizeScope(body.scope);
        const code = issueToken(
          "code",
          CODE_TTL_SEC,
          {
            sc: typeof scope === "string" ? scope.split(" ").filter(Boolean) : scope,
            cid: body.client_id,
            ru: body.redirect_uri,
            n: randomBytes(8).toString("base64url"),
          },
          "owner",
        );

        u.searchParams.set("code", code);
        if (body.state) u.searchParams.set("state", body.state);
        await log("out", "Verknüpfung zugestimmt", { scope, ttl: CODE_TTL_SEC });
        return jsonResponse({ redirect: u.toString() });
      },
    },
  },
});
