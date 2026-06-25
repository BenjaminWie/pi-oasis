import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { jsonResponse } from "@/lib/agent-api.server";

type Profile = {
  id: string;
  telegram_bot_token: string | null;
  telegram_webhook_secret: string | null;
  telegram_chat_id: number | null;
  telegram_link_code: string | null;
};

async function transcribeVoice(botToken: string, fileId: string): Promise<string | null> {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) return null;
  try {
    const fileRes = await fetch(
      `https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`,
    );
    const fileJson: any = await fileRes.json();
    if (!fileRes.ok || !fileJson.ok) return null;
    const filePath = fileJson.result.file_path as string;
    const audioRes = await fetch(`https://api.telegram.org/file/bot${botToken}/${filePath}`);
    if (!audioRes.ok) return null;
    const audioBuf = await audioRes.arrayBuffer();
    const ext = filePath.split(".").pop() || "ogg";

    const form = new FormData();
    form.append("model", "openai/gpt-4o-mini-transcribe");
    form.append("file", new Blob([audioBuf], { type: "audio/ogg" }), `voice.${ext}`);

    const ttRes = await fetch("https://ai.gateway.lovable.dev/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
    const tt: any = await ttRes.json().catch(() => ({}));
    if (!ttRes.ok) {
      console.error("[telegram/voice] transcribe", ttRes.status, tt);
      return null;
    }
    return (tt.text as string) || null;
  } catch (e) {
    console.error("[telegram/voice]", e);
    return null;
  }
}

async function mapVoiceToCommand(transcript: string): Promise<string | null> {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) return null;
  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Lovable-API-Key": apiKey },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          {
            role: "system",
            content:
              "You map a user's natural-language request (German or English) for a Raspberry Pi home server to ONE command. Allowed outputs (verbatim, nothing else): `/status`, `/containers`, `/devices`, or `/mqtt pub <topic> <message>`. If you cannot map, output exactly: unclear",
          },
          { role: "user", content: transcript },
        ],
      }),
    });
    const j: any = await res.json();
    if (!res.ok) return null;
    const txt = (j.choices?.[0]?.message?.content || "").trim();
    if (!txt || txt.toLowerCase() === "unclear") return null;
    return txt;
  } catch {
    return null;
  }
}

export const Route = createFileRoute("/api/public/telegram/webhook/$userId")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const { userId } = params;
        const headerSecret = request.headers.get("x-telegram-bot-api-secret-token") || "";

        const { data: profileRaw } = await supabaseAdmin
          .from("profiles")
          .select(
            "id, telegram_bot_token, telegram_webhook_secret, telegram_chat_id, telegram_link_code",
          )
          .eq("id", userId)
          .maybeSingle();
        const profile = profileRaw as Profile | null;
        if (!profile || !profile.telegram_bot_token || !profile.telegram_webhook_secret) {
          return jsonResponse({ ok: true, ignored: "no bot" });
        }
        if (headerSecret !== profile.telegram_webhook_secret) {
          return jsonResponse({ error: "unauthorized" }, 401);
        }

        const update: any = await request.json().catch(() => ({}));
        const msg = update.message;
        if (!msg?.chat?.id) return jsonResponse({ ok: true });
        const chatId = msg.chat.id as number;

        const reply = async (t: string) => {
          await fetch(`https://api.telegram.org/bot${profile.telegram_bot_token}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: chatId, text: t, parse_mode: "Markdown" }),
          }).catch(() => {});
        };

        // ---- Resolve text from either a text message or a voice/audio note
        let text: string | undefined = typeof msg.text === "string" ? msg.text.trim() : undefined;
        let voiceTranscript: string | null = null;

        if (!text) {
          const fileId: string | undefined = msg.voice?.file_id || msg.audio?.file_id;
          if (fileId) {
            voiceTranscript = await transcribeVoice(profile.telegram_bot_token, fileId);
            if (!voiceTranscript) {
              await reply("🎙 Konnte die Sprachnachricht nicht verstehen.");
              return jsonResponse({ ok: true });
            }
            await reply(`🎙 verstanden: «${voiceTranscript}»`);
            // If it doesn't look like a slash-command, ask AI to map intent
            text = voiceTranscript.trim();
            if (!text.startsWith("/")) {
              const mapped = await mapVoiceToCommand(text);
              if (!mapped) {
                await reply(
                  "🤖 Konnte daraus keinen Befehl ableiten. Versuch z.B. „Status“ oder „Container“.",
                );
                return jsonResponse({ ok: true });
              }
              text = mapped;
              await reply(`→ \`${mapped}\``);
            }
          }
        }

        if (!text) return jsonResponse({ ok: true });

        // ---- /start ----
        if (text.startsWith("/start")) {
          await reply(
            "👋 Pi Hub Bot.\nVerknüpfe diesen Chat mit:\n`/link DEIN-CODE`\n(Code findest du in der Cloud-UI unter Telegram)\n\nTipp: Du kannst auch Sprachnachrichten schicken.",
          );
          return jsonResponse({ ok: true });
        }

        // ---- /link <code> ----
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
          await reply(
            "✅ Verknüpft. Befehle: /devices /status /containers /mqtt pub <topic> <msg> · oder einfach Sprachnachricht",
          );
          return jsonResponse({ ok: true });
        }

        if (!profile.telegram_chat_id || profile.telegram_chat_id !== chatId) {
          await reply("🔒 Chat nicht verknüpft. Erst `/link DEIN-CODE` ausführen.");
          return jsonResponse({ ok: true });
        }

        await supabaseAdmin.from("telegram_audit").insert({
          user_id: userId,
          chat_id: chatId,
          command: voiceTranscript ? `🎙 ${voiceTranscript} → ${text}` : text,
        });

        const { data: devicesRaw } = await supabaseAdmin
          .from("devices")
          .select("id, name, last_seen_at, last_snapshot, device_token_hash")
          .eq("user_id", userId);
        const devices = (devicesRaw ?? []) as any[];
        const paired = devices.filter((d) => d.device_token_hash);

        if (text.startsWith("/devices")) {
          if (paired.length === 0) {
            await reply("Keine Geräte registriert.");
          } else {
            await reply(
              paired
                .map((d) => {
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
          if (arg) return paired.find((d) => d.name === arg);
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
                  cs
                    .map((c: any) => `${c.status === "running" ? "🟢" : "⚪"} ${c.name}`)
                    .join("\n"),
          );
          return jsonResponse({ ok: true });
        }

        if (text.startsWith("/mqtt")) {
          const parts = text.split(/\s+/);
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
