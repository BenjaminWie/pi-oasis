// Telegram webhook — DATABASE-FREE.
//
// Configuration lives in env instead of the `profiles` table:
//   PIHUB_TELEGRAM_BOT_TOKEN       bot token from @BotFather
//   PIHUB_TELEGRAM_WEBHOOK_SECRET  value sent as x-telegram-bot-api-secret-token
//   PIHUB_TELEGRAM_CHAT_IDS        comma separated allowlist of chat ids
//   PIHUB_LINK_SECRET              fallback: `/link <secret>` unlocks a chat
//
// Every command goes to the Pi through the relay (voice-intents), free text
// goes to the AI brain. Nothing is written anywhere.

import { createFileRoute } from "@tanstack/react-router";
import { jsonResponse } from "@/lib/agent-api.server";
import {
  energyPriceNow,
  mqttPublish,
  pumpOff,
  pumpOn,
  pumpStatus,
  systemStatus,
  type IntentCtx,
} from "@/lib/voice-intents.server";

const CTX: IntentCtx = { source: "telegram", deviceId: "pi" };

/** Chats unlocked with /link during this worker's lifetime (volatile). */
const runtimeChats = new Set<string>();

function allowlist(): Set<string> {
  return new Set(
    (process.env.PIHUB_TELEGRAM_CHAT_IDS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

function linkSecret() {
  return process.env.PIHUB_LINK_SECRET || process.env.PIHUB_DEVICE_TOKEN || "";
}

async function transcribeVoice(botToken: string, fileId: string): Promise<string | null> {
  try {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) return null;
    const fileRes = await fetch(
      `https://api.telegram.org/bot${botToken}/getFile?file_id=${encodeURIComponent(fileId)}`,
    ).then((r) => r.json());
    const filePath: string | undefined = fileRes?.result?.file_path;
    if (!filePath) return null;
    const audioRes = await fetch(`https://api.telegram.org/file/bot${botToken}/${filePath}`);
    if (!audioRes.ok) return null;
    const audioBuf = await audioRes.arrayBuffer();
    const ext = filePath.split(".").pop() || "ogg";
    const form = new FormData();
    form.append("model", "openai/gpt-4o-mini-transcribe");
    form.append("file", new Blob([audioBuf], { type: "audio/ogg" }), `voice.${ext}`);
    const ttRes = await fetch("https://ai.gateway.lovable.dev/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: form,
    });
    if (!ttRes.ok) {
      console.error("[telegram/voice] transcribe", ttRes.status);
      return null;
    }
    const tt = (await ttRes.json()) as { text?: string };
    return tt.text?.trim() || null;
  } catch (e) {
    console.error("[telegram/voice]", e);
    return null;
  }
}

const HELP =
  "*Pi Hub*\n" +
  "`/pump on 10` · `/pump off` · `/pump status`\n" +
  "`/status` · `/price` · `/mqtt pub <topic> <text>`\n" +
  "Oder frag einfach frei — auch per Sprachnachricht.";

export const Route = createFileRoute("/api/public/telegram/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const botToken = process.env.PIHUB_TELEGRAM_BOT_TOKEN;
        if (!botToken) return jsonResponse({ ok: true, ignored: "no bot configured" });

        const expected = process.env.PIHUB_TELEGRAM_WEBHOOK_SECRET || "";
        if (expected && request.headers.get("x-telegram-bot-api-secret-token") !== expected) {
          return jsonResponse({ error: "unauthorized" }, 401);
        }

        const update = (await request.json().catch(() => ({}))) as any;
        const msg = update.message;
        if (!msg?.chat?.id) return jsonResponse({ ok: true });
        const chatId = String(msg.chat.id);

        const reply = async (t: string) => {
          await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: msg.chat.id, text: t, parse_mode: "Markdown" }),
          }).catch(() => {});
        };

        // ---- text or voice ----
        let text: string | undefined = typeof msg.text === "string" ? msg.text.trim() : undefined;
        let transcript: string | null = null;
        if (!text) {
          const fileId: string | undefined = msg.voice?.file_id || msg.audio?.file_id;
          if (fileId) {
            transcript = await transcribeVoice(botToken, fileId);
            if (!transcript) {
              await reply("🎙 Konnte die Sprachnachricht nicht verstehen.");
              return jsonResponse({ ok: true });
            }
            await reply(`🎙 verstanden: «${transcript}»`);
            text = transcript;
          }
        }
        if (!text) return jsonResponse({ ok: true });

        // ---- access control (env allowlist or /link <secret>) ----
        const allowed = allowlist().has(chatId) || runtimeChats.has(chatId);

        if (text.startsWith("/start")) {
          await reply(
            allowed
              ? HELP
              : `👋 Pi Hub Bot.\nDieser Chat ist noch nicht freigeschaltet.\nSchreibe \`/link DEIN-LINK-SECRET\`.\nChat-ID: \`${chatId}\``,
          );
          return jsonResponse({ ok: true });
        }

        if (text.startsWith("/link")) {
          const given = text.split(/\s+/).slice(1).join(" ").trim();
          const secret = linkSecret();
          if (!secret) {
            await reply("⛔ Auf dem Server ist kein `PIHUB_LINK_SECRET` gesetzt.");
          } else if (given && given === secret) {
            runtimeChats.add(chatId);
            await reply(
              `✅ Chat freigeschaltet.\nDauerhaft: Chat-ID \`${chatId}\` in \`PIHUB_TELEGRAM_CHAT_IDS\` eintragen.\n\n${HELP}`,
            );
          } else {
            await reply("❌ Link-Secret falsch.");
          }
          return jsonResponse({ ok: true });
        }

        if (!allowed) {
          await reply(`🔒 Chat nicht freigeschaltet. \`/link DEIN-LINK-SECRET\`\nChat-ID: \`${chatId}\``);
          return jsonResponse({ ok: true });
        }

        if (text.startsWith("/help")) {
          await reply(HELP);
          return jsonResponse({ ok: true });
        }

        if (text.startsWith("/pump")) {
          const parts = text.split(/\s+/);
          const action = (parts[1] || "").toLowerCase();
          if (action === "status" || !action) {
            const r = await pumpStatus(CTX);
            await reply(`💧 ${r.speech}`);
            return jsonResponse({ ok: true });
          }
          if (!["on", "an", "off", "aus"].includes(action)) {
            await reply("Usage: `/pump on [minuten]` · `/pump off` · `/pump status`");
            return jsonResponse({ ok: true });
          }
          const isOn = action === "on" || action === "an";
          const minutes = Number(parts[2]);
          const r = isOn
            ? await pumpOn(CTX, Number.isFinite(minutes) ? minutes : undefined)
            : await pumpOff(CTX);
          await reply(`${isOn ? "💧" : "⏹️"} ${r.speech}`);
          return jsonResponse({ ok: true });
        }

        if (text.startsWith("/status")) {
          const r = await systemStatus(CTX);
          await reply(`📊 ${r.speech}`);
          return jsonResponse({ ok: true });
        }

        if (text.startsWith("/price") || text.startsWith("/strom")) {
          const r = await energyPriceNow(CTX);
          await reply(`⚡ ${r.speech}`);
          return jsonResponse({ ok: true });
        }

        if (text.startsWith("/mqtt")) {
          const parts = text.split(/\s+/);
          if (parts[1] === "pub" && parts[2]) {
            const r = await mqttPublish(CTX, parts[2], parts.slice(3).join(" "));
            await reply(`${r.ok ? "📡" : "⛔"} ${r.speech}`);
            return jsonResponse({ ok: true });
          }
          await reply("Usage: `/mqtt pub <topic> <nachricht>`");
          return jsonResponse({ ok: true });
        }

        if (!text.startsWith("/")) {
          try {
            const { brainReply } = await import("@/lib/assistant-brain.server");
            const answer = await brainReply(
              { userId: "owner", deviceId: "pi", scopes: ["read", "control"], tokenId: "telegram" },
              text,
              { channel: "telegram" },
            );
            await reply(answer);
          } catch (e: any) {
            await reply(`🤖 Fehler: ${String(e?.message || e).slice(0, 200)}`);
          }
          return jsonResponse({ ok: true });
        }

        await reply(`Unbekannter Befehl.\n\n${HELP}`);
        return jsonResponse({ ok: true });
      },
    },
  },
});
