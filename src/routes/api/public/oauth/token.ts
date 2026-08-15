// OAuth 2.0 Token endpoint (RFC 6749 §4.1.3 / §5.1) for Alexa Account Linking.
// DATABASE-FREE: codes, access tokens and refresh tokens are HMAC-signed and
// self-describing, so nothing needs to be stored or looked up.
//
// Config (cloud secrets):
//   PIHUB_OAUTH_CLIENT_ID / PIHUB_OAUTH_CLIENT_SECRET  — the Alexa skill client
//   PIHUB_TOKEN_SECRET                                 — HMAC signing key

import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "crypto";
import { jsonResponse } from "@/lib/agent-api.server";
import { normalizeScopes } from "@/lib/oauth-scope";
import { issueToken, oauthClient, verifyToken } from "@/lib/stateless-token.server";

const ACCESS_TTL_SEC = 60 * 60 * 24 * 30; // real validity: 30 days
const ALEXA_EXPIRES_IN = 3600; // advertised to Alexa → forces refresh cycle
const REFRESH_TTL_SEC = 60 * 60 * 24 * 365;

const NO_STORE = { "Cache-Control": "no-store", Pragma: "no-cache" };

function safeEqual(a: string, b: string) {
  const A = Buffer.from(a);
  const B = Buffer.from(b);
  return A.length === B.length && timingSafeEqual(A, B);
}

function oauthResponse(body: unknown, status = 200) {
  const r = jsonResponse(body, status);
  const h = new Headers(r.headers);
  for (const [k, v] of Object.entries(NO_STORE)) h.set(k, v);
  return new Response(r.body, { status: r.status, headers: h });
}

function parseCreds(request: Request, form: URLSearchParams) {
  const h = request.headers.get("authorization");
  if (h?.startsWith("Basic ")) {
    try {
      const [id, secret] = Buffer.from(h.slice(6), "base64").toString("utf-8").split(":");
      if (id && secret) return { client_id: id, client_secret: secret };
    } catch {
      /* fall through */
    }
  }
  return {
    client_id: form.get("client_id") ?? "",
    client_secret: form.get("client_secret") ?? "",
  };
}

function mint(sub: string, scopes: string[]) {
  const access = issueToken("access", ACCESS_TTL_SEC, { sc: scopes }, sub);
  const refresh = issueToken("refresh", REFRESH_TTL_SEC, { sc: scopes }, sub);
  return { access, refresh };
}

export const Route = createFileRoute("/api/public/oauth/token")({
  server: {
    handlers: {
      OPTIONS: () =>
        new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Authorization, Content-Type",
          },
        }),
      POST: async ({ request }) => {
        try {
          const form = new URLSearchParams(await request.text());
          const grant_type = form.get("grant_type");
          const { client_id, client_secret } = parseCreds(request, form);
          const client = oauthClient();

          if (!client.configured) {
            console.error("[oauth] client not configured (PIHUB_OAUTH_CLIENT_ID/SECRET)");
            return oauthResponse({ error: "server_error", error_description: "client not configured" }, 500);
          }
          if (
            !client_id ||
            !client_secret ||
            !safeEqual(client_id, client.id) ||
            !safeEqual(client_secret, client.secret)
          ) {
            console.warn("[oauth] invalid_client", { client_id, grant_type });
            return oauthResponse({ error: "invalid_client" }, 401);
          }

          if (grant_type === "authorization_code") {
            const code = form.get("code");
            const redirect_uri = form.get("redirect_uri");
            if (!code || !redirect_uri) return oauthResponse({ error: "invalid_request" }, 400);

            const payload = verifyToken(code, "code");
            if (!payload) return oauthResponse({ error: "invalid_grant" }, 400);
            if (payload.cid !== client_id || payload.ru !== redirect_uri) {
              console.warn("[oauth] code mismatch", { cid: payload.cid, ru: payload.ru });
              return oauthResponse({ error: "invalid_grant" }, 400);
            }

            const scopes = normalizeScopes((payload.sc as string[]) ?? ["read"]);
            const { access, refresh } = mint(payload.sub, scopes);
            return oauthResponse({
              access_token: access,
              token_type: "Bearer",
              expires_in: ALEXA_EXPIRES_IN,
              refresh_token: refresh,
              scope: scopes.join(" "),
            });
          }

          if (grant_type === "refresh_token") {
            const rt = form.get("refresh_token");
            const payload = verifyToken(rt, "refresh");
            if (!payload) return oauthResponse({ error: "invalid_grant" }, 400);
            const scopes = normalizeScopes((payload.sc as string[]) ?? ["read"]);
            const { access, refresh } = mint(payload.sub, scopes);
            return oauthResponse({
              access_token: access,
              token_type: "Bearer",
              expires_in: ALEXA_EXPIRES_IN,
              refresh_token: refresh,
              scope: scopes.join(" "),
            });
          }

          return oauthResponse({ error: "unsupported_grant_type" }, 400);
        } catch (e) {
          const msg = (e as Error)?.message ?? String(e);
          console.error("[oauth] server_error", msg);
          return oauthResponse({ error: "server_error", error_description: msg.slice(0, 200) }, 500);
        }
      },
    },
  },
});
