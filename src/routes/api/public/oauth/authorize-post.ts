// Server-side companion to authorize.tsx: handles POST /api/public/oauth/authorize
// by minting the single-use auth code once the user clicks Approve.
//
// The client page above calls fetch(POST /api/public/oauth/authorize) with the
// user's Supabase bearer, which we resolve here to auth.uid() before minting.

import { createFileRoute } from "@tanstack/react-router";
import { createHash, randomBytes } from "crypto";
import { jsonResponse, bearer } from "@/lib/agent-api.server";
import { normalizeScope } from "@/lib/oauth-scope";

export const Route = createFileRoute("/api/public/oauth/authorize-post")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = bearer(request);
        if (!token) return jsonResponse({ error: "unauthorized" }, 401);

        const body = await request.json().catch(() => ({})) as {
          approve?: boolean;
          client_id?: string;
          redirect_uri?: string;
          state?: string;
          scope?: string;
        };

        if (!body.client_id || !body.redirect_uri) {
          return jsonResponse({ error: "missing params" }, 400);
        }

        // Resolve the caller's user id from the Supabase bearer
        const authResp = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, {
          headers: {
            Authorization: `Bearer ${token}`,
            apikey: process.env.SUPABASE_PUBLISHABLE_KEY!,
          },
        });
        if (!authResp.ok) return jsonResponse({ error: "invalid session" }, 401);
        const user = (await authResp.json()) as { id?: string };
        if (!user.id) return jsonResponse({ error: "no user" }, 401);

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { isRedirectUriAllowed } = await import("@/lib/alexa-oauth.functions");

        // Instrumentation for the consent leg — without this we cannot tell
        // whether Alexa ever received a code (token log stays empty either way).
        const logConsent = (ok: boolean, error_code: string | null, note: string) =>
          supabaseAdmin
            .from("alexa_oauth_token_log")
            .insert({
              event: "authorize",
              ok,
              error_code,
              note,
              client_id: body.client_id ?? null,
              grant_type: null,
              remote_ip:
                request.headers.get("cf-connecting-ip") ??
                request.headers.get("x-forwarded-for"),
            })
            .then(() => {}, () => {});

        const { data: client } = await supabaseAdmin
          .from("alexa_oauth_clients")
          .select("id, user_id, device_id, redirect_uris")
          .eq("client_id", body.client_id)
          .maybeSingle();
        if (!client || client.user_id !== user.id) {
          console.warn("[alexa-oauth] approve: client not owned", { client_id: body.client_id, user_id: user.id });
          await logConsent(false, "client_not_owned", `user=${user.id}`);
          return jsonResponse({ error: "client not owned by user" }, 403);
        }
        const allowed = (client.redirect_uris as string[]) ?? [];
        if (!isRedirectUriAllowed(allowed, body.redirect_uri)) {
          console.warn("[alexa-oauth] approve: redirect_uri mismatch", {
            client_id: body.client_id,
            received: body.redirect_uri,
            allowed,
          });
          await logConsent(
            false,
            "redirect_uri_mismatch",
            `received=${body.redirect_uri} allowed=${allowed.join(",")}`,
          );
          return jsonResponse({ error: `redirect_uri not allowed: ${body.redirect_uri}` }, 400);
        }

        if (!body.approve) {
          const u = new URL(body.redirect_uri);
          u.searchParams.set("error", "access_denied");
          if (body.state) u.searchParams.set("state", body.state);
          await logConsent(false, "access_denied", "user declined");
          return jsonResponse({ redirect: u.toString() });
        }

        const code = randomBytes(24).toString("base64url");
        const code_hash = createHash("sha256").update(code).digest("hex");
        const expires_at = new Date(Date.now() + 10 * 60_000).toISOString();

        const { error } = await supabaseAdmin.from("alexa_oauth_codes").insert({
          code_hash,
          client_id: body.client_id,
          user_id: user.id,
          device_id: client.device_id,
          redirect_uri: body.redirect_uri,
          // 'control' always implies 'read' — every voice intent starts with a
          // read tool (list_plugins/get_status), so a control-only token would
          // fail with "missing scope read" before any tool runs.
          scope: normalizeScope(body.scope),
          expires_at,
        });
        if (error) {
          await logConsent(false, "code_insert_failed", error.message);
          return jsonResponse({ error: error.message }, 500);
        }

        const u = new URL(body.redirect_uri);
        u.searchParams.set("code", code);
        if (body.state) u.searchParams.set("state", body.state);
        // state is REQUIRED by Alexa: without it the app shows
        // "Konto konnte nicht mit Alexa verknüpft werden" even on a valid code.
        await logConsent(
          true,
          body.state ? null : "missing_state",
          `code issued → ${u.origin}${u.pathname}${body.state ? "" : " (NO state param!)"}`,
        );
        return jsonResponse({ redirect: u.toString() });
      },
    },
  },
});
