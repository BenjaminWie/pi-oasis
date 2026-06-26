import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { bearer, jsonResponse, sha256 } from "@/lib/ai/agent-api.server";

const Body = z.object({
  id: z.string().uuid(),
  ok: z.boolean(),
  result: z.any().optional(),
});

export const Route = createFileRoute("/api/public/agent/result")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = bearer(request);
        if (!token) return jsonResponse({ error: "no token" }, 401);
        const { data: device } = await supabaseAdmin
          .from("devices")
          .select("id, user_id")
          .eq("device_token_hash", sha256(token))
          .maybeSingle();
        if (!device) return jsonResponse({ error: "unknown device" }, 401);

        let body;
        try {
          body = Body.parse(await request.json());
        } catch {
          return jsonResponse({ error: "invalid body" }, 400);
        }

        // Verify the command belongs to this device
        const { data: cmd } = await supabaseAdmin
          .from("agent_commands")
          .select("id, kind, payload, source, user_id")
          .eq("id", body.id)
          .eq("device_id", device.id)
          .maybeSingle();
        if (!cmd) return jsonResponse({ error: "unknown command" }, 404);

        await supabaseAdmin
          .from("agent_commands")
          .update({
            status: body.ok ? "done" : "failed",
            result: body.result ?? null,
            completed_at: new Date().toISOString(),
          })
          .eq("id", body.id);

        // If command was telegram-initiated, send result to user's chat
        if (cmd.source === "telegram") {
          const { data: profile } = await supabaseAdmin
            .from("profiles")
            .select("telegram_bot_token, telegram_chat_id")
            .eq("id", cmd.user_id)
            .maybeSingle();
          if (profile?.telegram_bot_token && profile?.telegram_chat_id) {
            const text = formatResult(cmd.kind, body.ok, body.result);
            fetch(`https://api.telegram.org/bot${profile.telegram_bot_token}/sendMessage`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                chat_id: profile.telegram_chat_id,
                text,
                parse_mode: "Markdown",
              }),
            }).catch(() => {});
          }
        }

        return jsonResponse({ ok: true });
      },
    },
  },
});

function formatResult(kind: string, ok: boolean, result: any): string {
  if (!ok) return `❌ ${kind} fehlgeschlagen: ${truncate(JSON.stringify(result), 200)}`;
  if (kind === "status" && result) {
    const r = result;
    const containers = (r.containers || [])
      .map((c: any) => `  • ${c.name} — ${c.status}`)
      .join("\n");
    return [
      "✅ *Status*",
      `CPU: ${fmt(r.cpu)}%  RAM: ${fmt(r.ram)}%  Temp: ${fmt(r.temp)}°C  Disk: ${fmt(r.disk)}%`,
      containers ? `\nContainer:\n${containers}` : "",
    ].join("\n");
  }
  if (kind === "container_action") return `✅ Container ${result?.name}: ${result?.action} ok`;
  if (kind === "mqtt_publish") return `✅ MQTT publish ok`;
  return `✅ ${kind}: ${truncate(JSON.stringify(result), 300)}`;
}

function fmt(v: any) {
  return v == null ? "—" : Math.round(Number(v));
}
function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n) + "…" : s;
}
