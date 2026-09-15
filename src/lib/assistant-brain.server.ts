// Unified AI brain for cloud chat, Telegram free text/voice and Alexa.
//
// The model gets three generic tools over the Pi's self-announced endpoint
// catalogue — no hardcoded tool list, no database.

import {
  generateText,
  streamText,
  tool,
  stepCountIs,
  convertToModelMessages,
  type UIMessage,
  type ModelMessage,
} from "ai";
import { z } from "zod";
import { createLovableAiGatewayProvider } from "./ai-gateway.server";
import { invoke, readEndpoints, statusOf, type ToolCtx } from "./relay-tools.server";

export type { ToolCtx };

const SYSTEM_PROMPT = `Du bist der Pi-Control-Assistent. Du steuerst und beobachtest einen Raspberry Pi mit Node-RED (Bewässerungspumpe, Tasmota-Geräte, Sensoren, Container).

Regeln:
- Antworte kurz, natürlich und auf Deutsch (außer der Nutzer schreibt Englisch).
- Rate nie: hole die Endpunktliste bzw. Werte über die Tools.
- Endpunkte heißen so, wie Node-RED sie meldet. Wenn etwas fehlt, sag das offen.
- Bei Schaltaktionen bestätige knapp, was getan wurde.
- Ist der Pi offline, sag das in einem Satz.`;

function buildTools(ctx: ToolCtx) {
  return {
    list_endpoints: tool({
      description:
        "Liste aller Endpunkte, die der Pi meldet, inklusive aktueller Werte, Einheiten und ob sie geschaltet werden dürfen.",
      inputSchema: z.object({}),
      execute: async () => {
        const r = await readEndpoints();
        return {
          ok: r.ok,
          stale: r.stale,
          ageSec: r.ageSec,
          error: r.error,
          endpoints: r.endpoints,
        };
      },
    }),
    get_status: tool({
      description: "Aktueller Zustand: entweder alles oder ein bestimmter Endpunkt.",
      inputSchema: z.object({
        endpoint: z.string().max(64).optional().describe("Endpunkt-ID oder Name, leer = alles"),
      }),
      execute: async ({ endpoint }) => statusOf(endpoint),
    }),
    set_endpoint: tool({
      description:
        "Schaltet oder setzt einen Endpunkt. value ist true/false für Schalter, eine Zahl für Zahlenwerte, sonst Text.",
      inputSchema: z.object({
        endpoint: z.string().min(1).max(64),
        value: z.union([z.boolean(), z.number(), z.string()]),
      }),
      execute: async ({ endpoint, value }) => invoke(ctx, endpoint, value),
    }),
  };
}

function getModel() {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("Missing LOVABLE_API_KEY");
  return createLovableAiGatewayProvider(key)("google/gemini-3.6-flash");
}

/** One-shot reply (Telegram, Alexa). */
export async function brainReply(
  ctx: ToolCtx,
  userText: string,
  opts?: { channel?: "telegram" | "alexa" | "chat"; history?: ModelMessage[] },
): Promise<string> {
  const channelHint =
    opts?.channel === "alexa"
      ? "\n\nDu antwortest über Alexa Sprachausgabe. Maximal 2 Sätze, keine Markdown-Zeichen."
      : opts?.channel === "telegram"
        ? "\n\nDu antwortest im Telegram-Chat. Kurz, freundlich, Markdown erlaubt."
        : "";

  const result = await generateText({
    model: getModel(),
    system: SYSTEM_PROMPT + channelHint,
    messages: [...(opts?.history ?? []), { role: "user", content: userText }],
    tools: buildTools(ctx),
    stopWhen: stepCountIs(20),
  });
  return result.text?.trim() || "Ich habe leider keine Antwort formuliert.";
}

/** Streaming chat handler for /api/chat. */
export async function brainStream(ctx: ToolCtx, messages: UIMessage[]) {
  const result = streamText({
    model: getModel(),
    system: SYSTEM_PROMPT + "\n\nDu antwortest im Chat-Interface, Markdown erlaubt.",
    messages: await convertToModelMessages(messages),
    tools: buildTools(ctx),
    stopWhen: stepCountIs(20),
  });
  return result.toUIMessageStreamResponse({ originalMessages: messages });
}
