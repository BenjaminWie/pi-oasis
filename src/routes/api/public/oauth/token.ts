// OAuth 2.0 Token endpoint (RFC 6749 §4.1.3) for Alexa Account Linking.
//
// POST /api/public/oauth/token
//   application/x-www-form-urlencoded, HTTP Basic auth = client_id:client_secret
//
// grant_type=authorization_code
//   -> validates the code (sha256 hash lookup, one-shot, expiry, redirect_uri
//      match), then mints an opaque mcp_tokens row (source='alexa') and returns
//      { access_token, token_type: "Bearer", expires_in, refresh_token }.
//
// grant_type=refresh_token
//   -> extends the linked mcp_tokens row's expiry and returns a new access_token.

import { createFileRoute } from "@tanstack/react-router";
import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { jsonResponse } from "@/lib/agent-api.server";

const ACCESS_TTL_SEC = 60 * 60 * 24 * 30; // 30 days
const REFRESH_PREFIX = "rt_";

function sha(s: string) {
  return createHash("sha256").update(s).digest("hex");
}

function safeEqual(a: string, b: string) {
  const A = Buffer.from(a);
  const B = Buffer.from(b);
  if (A.length !== B.length) return false;
  return timingSafeEqual(A, B);
}

async function parseCreds(request: Request, form: URLSearchParams) {
  // HTTP Basic first, then body fallback (Alexa uses either).
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
        const ct = request.headers.get("content-type") ?? "";
        const bodyText = await request.text();
        const form = ct.includes("application/x-www-form-urlencoded")
          ? new URLSearchParams(bodyText)
          : new URLSearchParams(bodyText); // Alexa always sends form; be tolerant.

        const grant_type = form.get("grant_type");
        const { client_id, client_secret } = await parseCreds(request, form);
        if (!client_id || !client_secret) {
          return jsonResponse({ error: "invalid_client" }, 401);
        }
        const client = await verifyClient(client_id, client_secret);
        if (!client) return jsonResponse({ error: "invalid_client" }, 401);

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        if (grant_type === "authorization_code") {
          const code = form.get("code");
          const redirect_uri = form.get("redirect_uri");
          if (!code || !redirect_uri) return jsonResponse({ error: "invalid_request" }, 400);
          const code_hash = sha(code);
          const { data: row } = await supabaseAdmin
            .from("alexa_oauth_codes")
            .select("*")
            .eq("code_hash", code_hash)
            .maybeSingle();
          if (!row) return jsonResponse({ error: "invalid_grant" }, 400);
          if (row.client_id !== client_id) return jsonResponse({ error: "invalid_grant" }, 400);
          if (row.redirect_uri !== redirect_uri) return jsonResponse({ error: "invalid_grant" }, 400);
          if (row.used_at) return jsonResponse({ error: "invalid_grant" }, 400);
          if (new Date(row.expires_at).getTime() < Date.now()) {
            return jsonResponse({ error: "invalid_grant" }, 400);
          }
          // single-use: delete immediately
          await supabaseAdmin.from("alexa_oauth_codes").delete().eq("code_hash", code_hash);

          const refresh_token = REFRESH_PREFIX + randomBytes(24).toString("base64url");
          const scopes = (row.scope ?? "control").split(/[\s,]+/).filter(Boolean);
          const { access } = await mintAccessToken({
            user_id: row.user_id,
            device_id: row.device_id,
            scopes,
            refresh_token,
          });

          await supabaseAdmin
            .from("alexa_oauth_clients")
            .update({ last_used_at: new Date().toISOString() })
            .eq("client_id", client_id);

          return jsonResponse({
            access_token: access,
            token_type: "Bearer",
            expires_in: ACCESS_TTL_SEC,
            refresh_token,
            scope: scopes.join(" "),
          });
        }

        if (grant_type === "refresh_token") {
          const refresh_token = form.get("refresh_token");
          if (!refresh_token) return jsonResponse({ error: "invalid_request" }, 400);
          const rt_hash = sha(refresh_token);
          const { data: existing } = await supabaseAdmin
            .from("mcp_tokens")
            .select("id, user_id, device_id, scopes")
            .eq("refresh_token_hash", rt_hash)
            .eq("source", "alexa")
            .maybeSingle();
          if (!existing) return jsonResponse({ error: "invalid_grant" }, 400);

          // rotate: delete old row, issue fresh access+refresh
          await supabaseAdmin.from("mcp_tokens").delete().eq("id", existing.id);
          const new_refresh = REFRESH_PREFIX + randomBytes(24).toString("base64url");
          const { access } = await mintAccessToken({
            user_id: existing.user_id,
            device_id: existing.device_id,
            scopes: (existing.scopes ?? ["control"]) as string[],
            refresh_token: new_refresh,
          });
          return jsonResponse({
            access_token: access,
            token_type: "Bearer",
            expires_in: ACCESS_TTL_SEC,
            refresh_token: new_refresh,
            scope: ((existing.scopes ?? ["control"]) as string[]).join(" "),
          });
        }

        return jsonResponse({ error: "unsupported_grant_type" }, 400);
      },
    },
  },
});
