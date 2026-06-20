import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { jsonResponse } from "@/lib/agent-api.server";

export const Route = createFileRoute("/api/public/telegram/webhook/$userId")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const { userId } = params;
        const headerSecret = request.headers.get("x-telegram-bot-api-secret-token") || "";

        const { data: profile } = await supabaseAdmin
          .from("profiles")
          .select("id, telegram_bot_token, telegram_webhook_secret, telegram_chat_id, telegram_link_code")
          .eq("id", userId)
          .maybeSingle();
        if (!profile || !profile.telegram_bot_token || !profile.telegram_webhook_secret) {
          return jsonResponse({ ok: true, ignored: "no bot" });
        }
        if (headerSecret !== profile.telegram_webhook_secret) {
          return jsonResponse({ error: "unauthorized" }, 401);
        }

        const update = await request.json().catch(() => ({}));
        const msg = update.message;
        if (!msg?.chat?.id || !msg.text) return jsonResponse({ ok: true });

        const chatId = msg.chat.id as number;
        const text: string = msg.text.trim();
        const reply = async (t: string) => {
          await fetch(`https://api.telegram.org/bot${profile.telegram_bot_token}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: chatId, text: t, parse_mode: "Markdown" }),
          }).catch(() => {});
        };

        // /link <code>  -- bind chat to account
        if (text.startsWith("/start")) {
          await reply(
            "👋 Pi Hub Bot.\nVerknüpfe diesen Chat mit:\n`/link DEIN-CODE`\n(Code findest du in der Cloud-UI unter Telegram)",
          );
          return jsonResponse({ ok: true });
        }

        if (text.startsWith("/link")) {
          const code = text.split(/\s+/)[1]?.toUpperCase() || "";
          if (!profile.telegram_link_code || profile.telegram_link_code !== code) {
            await reply("❌ Code ungültig.");
            return jsonResponse({ ok: true });
          }
          await supabaseAdmin
            .from("profiles")
            .update({
              telegram_chat_id: chatId,
              telegram_linked_at: new Date().toISOString(),
              telegram_link_code: null,
            })
            .eq("id", userId);
          await reply("✅ Verknüpft. Befehle: /devices /status /containers /mqtt pub <topic> <msg>");
          return jsonResponse({ ok: true });
        }

        // From here on: require linked chat
        if (!profile.telegram_chat_id || profile.telegram_chat_id !== chatId) {
          await reply("🔒 Chat nicht verknüpft. Erst `/link DEIN-CODE` ausführen.");
          return jsonResponse({ ok: true });
        }

        await supabaseAdmin.from("telegram_audit").insert({
          user_id: userId,
          chat_id: chatId,
          command: text,
        });

        // Fetch user's devices
        const { data: devices = [] } = await supabaseAdmin
          .from("devices")
          .select("id, name, last_seen_at, last_snapshot, device_token_hash")
          .eq("user_id", userId);
        const paired = (devices ?? []).filter((d: any) => d.device_token_hash);

        if (text.startsWith("/devices")) {
          if (paired.length === 0) {
            await reply("Keine Geräte registriert.");
          } else {
            await reply(
              paired
                .map((d: any) => {
                  const online =
                    d.last_seen_at && Date.now() - new Date(d.last_seen_at).getTime() < 120_000;
                  return `${online ? "🟢" : "⚪"} *${d.name}*`;
                })
                .join("\n"),
            );
          }
          return jsonResponse({ ok: true });
        }

        const pickDevice = (arg?: string) => {
          if (arg) return paired.find((d: any) => d.name === arg);
          return paired[0];
        };

        if (text.startsWith("/status")) {
          const arg = text.split(/\s+/)[1];
          const dev = pickDevice(arg);
          if (!dev) {
            await reply("Kein Gerät verknüpft.");
            return jsonResponse({ ok: true });
          }
          await supabaseAdmin.from("agent_commands").insert({
            device_id: dev.id,
            user_id: userId,
            kind: "status",
            source: "telegram",
          });
          await reply(`⏳ Status von *${dev.name}* angefordert...`);
          return jsonResponse({ ok: true });
        }

        if (text.startsWith("/containers")) {
          const dev = pickDevice();
          if (!dev) return jsonResponse({ ok: true });
          const snap = (dev.last_snapshot as any) || {};
          const cs = snap.containers || [];
          await reply(
            cs.length === 0
              ? "Keine Container-Daten. /status für frische Daten."
              : `*${dev.name}*\n` +
                  cs.map((c: any) => `${c.status === "running" ? "🟢" : "⚪"} ${c.name}`).join("\n"),
          );
          return jsonResponse({ ok: true });
        }

        if (text.startsWith("/mqtt")) {
          const parts = text.split(/\s+/);
          // /mqtt pub <topic> <payload...>
          if (parts[1] === "pub" && parts[2]) {
            const topic = parts[2];
            const payload = parts.slice(3).join(" ");
            const dev = pickDevice();
            if (!dev) return jsonResponse({ ok: true });
            await supabaseAdmin.from("agent_commands").insert({
              device_id: dev.id,
              user_id: userId,
              kind: "mqtt_publish",
              payload: { topic, payload },
              source: "telegram",
            });
            await reply(`⏳ MQTT publish \`${topic}\` an *${dev.name}*...`);
            return jsonResponse({ ok: true });
          }
          await reply("Usage: `/mqtt pub <topic> <nachricht>`");
          return jsonResponse({ ok: true });
        }

        await reply("Unbekannter Befehl. /devices /status /containers /mqtt");
        return jsonResponse({ ok: true });
      },
    },
  },
});
