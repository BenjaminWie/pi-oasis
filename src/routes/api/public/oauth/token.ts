// OAuth 2.0 Token endpoint (RFC 6749 §4.1.3 / §5.1) for Alexa Account Linking.
//
// Every response includes RFC-required no-store cache headers, and every
// exchange (success + failure) is logged to `alexa_oauth_token_log` so the UI
// can show why Alexa gave up. Alexa expects access-token lifetimes in the
// 1h ballpark for its refresh scheduler, so we cap `expires_in` at 3600
// while keeping the underlying token valid for 30d (Alexa will refresh long
// before that, giving us cheap re-verification).

import { createFileRoute } from "@tanstack/react-router";
import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { jsonResponse } from "@/lib/agent-api.server";
import { normalizeScopes } from "@/lib/oauth-scope";

const ACCESS_TTL_SEC = 60 * 60 * 24 * 30; // 30 days actual validity
const ALEXA_EXPIRES_IN = 3600;             // what we advertise to Alexa (1h → forces refresh cycle)
const REFRESH_PREFIX = "rt_";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
  Pragma: "no-cache",
};

function sha(s: string) {
  return createHash("sha256").update(s).digest("hex");
}

function safeEqual(a: string, b: string) {
  const A = Buffer.from(a);
  const B = Buffer.from(b);
  if (A.length !== B.length) return false;
  return timingSafeEqual(A, B);
}

function oauthResponse(body: unknown, status = 200) {
  const r = jsonResponse(body, status);
  const h = new Headers(r.headers);
  for (const [k, v] of Object.entries(NO_STORE_HEADERS)) h.set(k, v);
  return new Response(r.body, { status: r.status, headers: h });
}

async function logExchange(row: {
  event: string;
  client_id?: string | null;
  grant_type?: string | null;
  ok: boolean;
  error_code?: string | null;
  note?: string | null;
  remote_ip?: string | null;
}) {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("alexa_oauth_token_log").insert(row);
  } catch (e) {
    console.error("[alexa-oauth-token] log failed", (e as Error).message);
  }
}

async function parseCreds(request: Request, form: URLSearchParams) {
  const h = request.headers.get("authorization");
  if (h?.startsWith("Basic ")) {
    try {
      const [id, secret] = Buffer.from(h.slice(6), "base64").toString("utf-8").split(":");
      if (id && secret) return { client_id: id, client_secret: secret };
    } catch { /* fall through */ }
  }
  return {
    client_id: form.get("client_id") ?? "",
    client_secret: form.get("client_secret") ?? "",
  };
}

async function verifyClient(client_id: string, client_secret: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: client } = await supabaseAdmin
    .from("alexa_oauth_clients")
    .select("id, user_id, device_id, client_secret_hash, scopes")
    .eq("client_id", client_id)
    .maybeSingle();
  if (!client) return null;
  if (!safeEqual(client.client_secret_hash, sha(client_secret))) return null;
  return client;
}

async function mintAccessToken(opts: {
  user_id: string;
  device_id: string | null;
  scopes: string[];
  refresh_token: string;
}) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const access = randomBytes(32).toString("base64url");
  const access_hash = sha(access);
  const expires_at = new Date(Date.now() + ACCESS_TTL_SEC * 1000).toISOString();

  const { error } = await supabaseAdmin.from("mcp_tokens").insert({
    user_id: opts.user_id,
    device_id: opts.device_id,
    token_hash: access_hash,
    token_prefix: access.slice(0, 8),
    scopes: opts.scopes,
    expires_at,
    name: "alexa",
    source: "alexa",
    refresh_token_hash: sha(opts.refresh_token),
  } as any);
  if (error) throw new Error(error.message);
  return { access, expires_at };
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
        const remote_ip =
          request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
          request.headers.get("cf-connecting-ip") ?? null;
        const bodyText = await request.text();
        const form = new URLSearchParams(bodyText);
        const grant_type = form.get("grant_type");
        const { client_id, client_secret } = await parseCreds(request, form);

        console.info("[alexa-oauth-token] request", { grant_type, client_id, remote_ip });

        if (!client_id || !client_secret) {
          await logExchange({ event: "token", client_id, grant_type, ok: false, error_code: "invalid_client", note: "missing credentials", remote_ip });
          return oauthResponse({ error: "invalid_client" }, 401);
        }
        const client = await verifyClient(client_id, client_secret);
        if (!client) {
          await logExchange({ event: "token", client_id, grant_type, ok: false, error_code: "invalid_client", note: "bad secret or unknown client", remote_ip });
          return oauthResponse({ error: "invalid_client" }, 401);
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        if (grant_type === "authorization_code") {
          const code = form.get("code");
          const redirect_uri = form.get("redirect_uri");
          if (!code || !redirect_uri) {
            await logExchange({ event: "token", client_id, grant_type, ok: false, error_code: "invalid_request", note: "missing code or redirect_uri", remote_ip });
            return oauthResponse({ error: "invalid_request" }, 400);
          }
          const code_hash = sha(code);
          const { data: row } = await supabaseAdmin
            .from("alexa_oauth_codes")
            .select("*")
            .eq("code_hash", code_hash)
            .maybeSingle();
          if (!row) {
            await logExchange({ event: "token", client_id, grant_type, ok: false, error_code: "invalid_grant", note: "code not found", remote_ip });
            return oauthResponse({ error: "invalid_grant" }, 400);
          }
          if (row.client_id !== client_id) {
            await logExchange({ event: "token", client_id, grant_type, ok: false, error_code: "invalid_grant", note: "client_id mismatch", remote_ip });
            return oauthResponse({ error: "invalid_grant" }, 400);
          }
          if (row.redirect_uri !== redirect_uri) {
            await logExchange({ event: "token", client_id, grant_type, ok: false, error_code: "invalid_grant", note: `redirect_uri mismatch (got ${redirect_uri})`, remote_ip });
            return oauthResponse({ error: "invalid_grant" }, 400);
          }
          if (row.used_at) {
            await logExchange({ event: "token", client_id, grant_type, ok: false, error_code: "invalid_grant", note: "code already used", remote_ip });
            return oauthResponse({ error: "invalid_grant" }, 400);
          }
          if (new Date(row.expires_at).getTime() < Date.now()) {
            await logExchange({ event: "token", client_id, grant_type, ok: false, error_code: "invalid_grant", note: "code expired", remote_ip });
            return oauthResponse({ error: "invalid_grant" }, 400);
          }
          // Mint FIRST, mark the code used afterwards. Deleting the code up
          // front used to destroy it whenever the token insert failed, leaving
          // Alexa with an unrecoverable "linking failed" and no log row.
          const refresh_token = REFRESH_PREFIX + randomBytes(24).toString("base64url");
          const scopes = normalizeScopes(row.scope);
          const { access } = await mintAccessToken({
            user_id: row.user_id,
            device_id: row.device_id ?? null,
            scopes,
            refresh_token,
          });

          await supabaseAdmin
            .from("alexa_oauth_codes")
            .update({ used_at: new Date().toISOString() })
            .eq("code_hash", code_hash);

          await supabaseAdmin
            .from("alexa_oauth_clients")
            .update({ last_used_at: new Date().toISOString() })
            .eq("client_id", client_id);

          await logExchange({ event: "token", client_id, grant_type, ok: true, note: "authorization_code exchange", remote_ip });

          return oauthResponse({
            access_token: access,
            token_type: "Bearer",
            expires_in: ALEXA_EXPIRES_IN,
            refresh_token,
            scope: scopes.join(" "),
          });
        }

        if (grant_type === "refresh_token") {
          const refresh_token = form.get("refresh_token");
          if (!refresh_token) {
            await logExchange({ event: "token", client_id, grant_type, ok: false, error_code: "invalid_request", note: "missing refresh_token", remote_ip });
            return oauthResponse({ error: "invalid_request" }, 400);
          }
          const rt_hash = sha(refresh_token);
          const { data: existing } = await supabaseAdmin
            .from("mcp_tokens")
            .select("id, user_id, device_id, scopes")
            .eq("refresh_token_hash", rt_hash)
            .eq("source", "alexa")
            .maybeSingle();
          if (!existing) {
            await logExchange({ event: "token", client_id, grant_type, ok: false, error_code: "invalid_grant", note: "unknown refresh_token", remote_ip });
            return oauthResponse({ error: "invalid_grant" }, 400);
          }

          await supabaseAdmin.from("mcp_tokens").delete().eq("id", existing.id);
          const new_refresh = REFRESH_PREFIX + randomBytes(24).toString("base64url");
          const scopes = normalizeScopes(existing.scopes as string[] | null);
          const { access } = await mintAccessToken({
            user_id: existing.user_id,
            device_id: existing.device_id,
            scopes,
            refresh_token: new_refresh,
          });
          await logExchange({ event: "token", client_id, grant_type, ok: true, note: "refresh_token rotated", remote_ip });
          return oauthResponse({
            access_token: access,
            token_type: "Bearer",
            expires_in: ALEXA_EXPIRES_IN,
            refresh_token: new_refresh,
            scope: scopes.join(" "),
          });
        }

        await logExchange({ event: "token", client_id, grant_type, ok: false, error_code: "unsupported_grant_type", remote_ip });
        return oauthResponse({ error: "unsupported_grant_type" }, 400);
       } catch (e) {
         const msg = (e as Error)?.message ?? String(e);
         console.error("[alexa-oauth-token] server_error", msg);
         await logExchange({
           event: "token",
           ok: false,
           error_code: "server_error",
           note: msg.slice(0, 400),
         });
         return oauthResponse({ error: "server_error", error_description: msg.slice(0, 200) }, 500);
       }
      },
    },
  },
});
