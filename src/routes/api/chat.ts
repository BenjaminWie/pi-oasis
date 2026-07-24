// Streaming chat endpoint for the cloud Assistant UI.
// Auth: caller must include a Supabase user access token in Authorization: Bearer.
// The user's first paired device is used as the tool context.

import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { UIMessage } from "ai";
import { brainStream } from "@/lib/assistant-brain.server";
import type { ToolCtx } from "@/lib/mcp-tools.server";

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = request.headers.get("authorization") || "";
        const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
        if (!token) return new Response("Unauthorized", { status: 401 });

        const supa = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
          auth: { persistSession: false, autoRefreshToken: false },
          global: { headers: { Authorization: `Bearer ${token}` } },
        });
        const { data: userRes, error: userErr } = await supa.auth.getUser();
        if (userErr || !userRes.user) return new Response("Unauthorized", { status: 401 });
        const userId = userRes.user.id;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: dev } = await supabaseAdmin
          .from("devices")
          .select("id, device_token_hash")
          .eq("user_id", userId)
          .not("device_token_hash", "is", null)
          .order("last_seen_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (!dev) return new Response("No paired device", { status: 400 });

        let body: { messages?: UIMessage[] };
        try {
          body = await request.json();
        } catch {
          return new Response("Bad JSON", { status: 400 });
        }
        if (!Array.isArray(body.messages)) return new Response("messages required", { status: 400 });

        const ctx: ToolCtx = {
          userId,
          deviceId: dev.id,
          scopes: ["read", "control"],
          tokenId: "chat-session",
        };
        try {
          return await brainStream(ctx, body.messages);
        } catch (e: any) {
          return new Response(String(e?.message || e), { status: 500 });
        }
      },
    },
  },
});
