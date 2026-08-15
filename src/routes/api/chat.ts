// Streaming chat endpoint for the cloud Assistant UI.
// Auth: caller must include a Supabase user access token in Authorization: Bearer.
// The user's first paired device is used as the tool context.
// Errors are returned as structured JSON with a `code` so the UI can show a
// human-readable reason instead of a generic "not authorized".

import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { UIMessage } from "ai";
import { brainStream } from "@/lib/assistant-brain.server";
import type { ToolCtx } from "@/lib/mcp-tools.server";

function jsonError(code: string, message: string, status: number) {
  return new Response(JSON.stringify({ error: message, code }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = request.headers.get("authorization") || "";
        const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
        if (!token) {
          console.warn("[chat] missing bearer");
          return jsonError("unauthorized", "Bitte neu anmelden.", 401);
        }

        const supa = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
          auth: { persistSession: false, autoRefreshToken: false },
          global: { headers: { Authorization: `Bearer ${token}` } },
        });
        const { data: userRes, error: userErr } = await supa.auth.getUser();
        if (userErr || !userRes.user) {
          console.warn("[chat] getUser failed", userErr?.message);
          return jsonError("unauthorized", "Session ungültig. Bitte neu anmelden.", 401);
        }
        const userId = userRes.user.id;

        // DATABASE-FREE: there is no `devices` table any more — a Pi-Hub
        // install talks to exactly one Pi through the relay.
        const { piConfig } = await import("@/lib/pi-relay.server");
        if (!piConfig().configured) {
          return jsonError(
            "no_paired_device",
            "Kein Pi verbunden. Erst unter Connect → Verkabelung die Relay-URL setzen.",
            400,
          );
        }


        let body: { messages?: UIMessage[] };
        try {
          body = await request.json();
        } catch {
          return jsonError("bad_json", "Ungültige Anfrage.", 400);
        }
        if (!Array.isArray(body.messages)) {
          return jsonError("bad_messages", "messages required", 400);
        }

        const ctx: ToolCtx = {
          userId,
          deviceId: "pi",
          scopes: ["read", "control"],
          tokenId: "chat-session",
        };
        try {
          return await brainStream(ctx, body.messages);
        } catch (e: any) {
          console.error("[chat] brainStream error", e?.message ?? e);
          return jsonError("brain_error", String(e?.message || e), 500);
        }
      },
    },
  },
});
