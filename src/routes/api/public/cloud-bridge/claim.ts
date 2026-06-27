// One-shot pickup endpoint: the Pi POSTs the raw nonce, we hash it, find the
// matching `cloud_pairings` row, mark it claimed, and return the device
// token bundle. No auth header — the nonce IS the auth, single-use + 10min TTL.
import { createFileRoute } from "@tanstack/react-router";
import { jsonResponse } from "@/lib/agent-api.server";

export const Route = createFileRoute("/api/public/cloud-bridge/claim")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: any;
        try {
          body = await request.json();
        } catch {
          return jsonResponse({ error: "invalid json" }, 400);
        }
        const nonce = String(body?.nonce || "");
        if (nonce.length < 8) return jsonResponse({ error: "invalid nonce" }, 400);

        const { createHash } = await import("node:crypto");
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const nonceHash = createHash("sha256").update(nonce).digest("hex");

        const { data: pairing } = await supabaseAdmin
          .from("cloud_pairings")
          .select("id, device_id, device_token, device_name, expires_at, claimed_at")
          .eq("nonce_hash", nonceHash)
          .maybeSingle();

        if (!pairing) return jsonResponse({ error: "not ready" }, 404);
        if ((pairing as any).claimed_at) return jsonResponse({ error: "already claimed" }, 410);
        if (new Date((pairing as any).expires_at).getTime() < Date.now()) {
          return jsonResponse({ error: "expired" }, 410);
        }

        const { error: upErr } = await supabaseAdmin
          .from("cloud_pairings")
          .update({ claimed_at: new Date().toISOString() })
          .eq("id", (pairing as any).id)
          .is("claimed_at", null);
        if (upErr) return jsonResponse({ error: upErr.message }, 500);

        return jsonResponse({
          deviceId: (pairing as any).device_id,
          deviceToken: (pairing as any).device_token,
          name: (pairing as any).device_name,
        });
      },
    },
  },
});
