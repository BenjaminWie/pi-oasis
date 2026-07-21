// Server-side companion to authorize.tsx: handles POST /api/public/oauth/authorize
// by minting the single-use auth code once the user clicks Approve.
//
// The client page above calls fetch(POST /api/public/oauth/authorize) with the
// user's Supabase bearer, which we resolve here to auth.uid() before minting.

import { createFileRoute } from "@tanstack/react-router";
import { createHash, randomBytes } from "crypto";
import { jsonResponse, bearer } from "@/lib/agent-api.server";

export const Route = createFileRoute("/api/public/oauth/authorize/post")({
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
        const { data: client } = await supabaseAdmin
          .from("alexa_oauth_clients")
          .select("id, user_id, device_id, redirect_uris")
          .eq("client_id", body.client_id)
          .maybeSingle();
        if (!client || client.user_id !== user.id) {
          return jsonResponse({ error: "client not owned by user" }, 403);
        }
        if (!(client.redirect_uris as string[]).includes(body.redirect_uri)) {
          return jsonResponse({ error: "redirect_uri not allowed" }, 400);
        }

        if (!body.approve) {
          const u = new URL(body.redirect_uri);
          u.searchParams.set("error", "access_denied");
          if (body.state) u.searchParams.set("state", body.state);
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
          scope: body.scope ?? "control",
          expires_at,
        });
        if (error) return jsonResponse({ error: error.message }, 500);

        const u = new URL(body.redirect_uri);
        u.searchParams.set("code", code);
        if (body.state) u.searchParams.set("state", body.state);
        return jsonResponse({ redirect: u.toString() });
      },
    },
  },
});
