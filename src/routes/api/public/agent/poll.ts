import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { bearer, jsonResponse, sha256 } from "@/lib/agent-api.server";

async function findDevice(token: string) {
  const hash = sha256(token);
  const { data } = await supabaseAdmin
    .from("devices")
    .select("id, user_id")
    .eq("device_token_hash", hash)
    .maybeSingle();
  return data;
}

export const Route = createFileRoute("/api/public/agent/poll")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const token = bearer(request);
        if (!token) return jsonResponse({ error: "no token" }, 401);
        const device = await findDevice(token);
        if (!device) return jsonResponse({ error: "unknown device" }, 401);
        const runner = new URL(request.url).searchParams.get("runner");

        // Touch last_seen
        await supabaseAdmin
          .from("devices")
          .update({ last_seen_at: new Date().toISOString() })
          .eq("id", device.id);

        // Zero-Wake: single query only. Node-RED / the Pi bridge subscribes to
        // the Supabase Realtime channel `commands:<device_id>` and only calls
        // this endpoint when a "wake" broadcast fires (see broadcast.server.ts).
        // A 15-minute safety-net poll still runs on the client side.
        const { data: pending } = await supabaseAdmin
          .from("agent_commands")
          .select("id, kind, payload")
          .eq("device_id", device.id)
          .eq("status", "pending")
          .order("created_at", { ascending: true })
          .limit(100);

        const cmd = (pending ?? []).find((candidate: any) => {
          const target = candidate.payload?.runner;
          return runner === "nodered" ? target === "nodered" : target !== "nodered";
        });

        if (cmd) {
          await supabaseAdmin
            .from("agent_commands")
            .update({ status: "delivered", delivered_at: new Date().toISOString() })
            .eq("id", cmd.id);
          return jsonResponse({ command: cmd });
        }
        return new Response(null, { status: 204 });
      },
    },
  },
});
