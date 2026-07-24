// Unified AI brain used by cloud chat, Telegram freetext/voice, and Alexa AskIntent.
// Wraps existing MCP tools (mcp-tools.server.ts) as AI SDK tools so the LLM can
// call get_status, pump_set, list_plugins, etc. via function calling.
//
// Zero-Wake compliance: read tools hit Supabase only; control tools enqueue
// agent_commands + broadcast wake exactly like MCP/voice-intents do today.

import { generateText, streamText, tool, stepCountIs, convertToModelMessages, type UIMessage, type ModelMessage } from "ai";
import { z } from "zod";
import { createLovableAiGatewayProvider } from "./ai-gateway.server";
import { getToolsForDevice, writeAudit, type ToolCtx, type ToolDef } from "./mcp-tools.server";

const SYSTEM_PROMPT = `Du bist der Pi-Hub Assistent. Du hilfst dem Nutzer, seinen Raspberry Pi, die Bewässerungspumpe, Tasmota-Geräte, Container und Plugins zu steuern und Fragen zu Strompreisen, Wetter und Wäsche zu beantworten.

Regeln:
- Antworte kurz, natürlich und auf Deutsch (außer der Nutzer schreibt Englisch).
- Nutze die verfügbaren Tools, um echte Daten abzurufen oder Aktionen auszuführen. Rate nicht.
- Bei Steueraktionen (Pumpe an/aus, Plugin schalten) bestätige knapp, was getan wurde.
- Bei Fehlern (pi_offline, missing scope) erkläre in einem Satz, was los ist.
- Keine Emojis inflationär, max. 1-2 pro Antwort.`;

function buildTools(ctx: ToolCtx, defs: ToolDef[]) {
  const map: Record<string, ReturnType<typeof tool>> = {};
  for (const def of defs) {
    if (!ctx.scopes.includes(def.scope)) continue;
    map[def.name] = tool({
      description: def.description,
      inputSchema: def.inputSchema as z.ZodTypeAny,
      execute: async (args: unknown) => {
        const t0 = Date.now();
        try {
          const out = await def.execute(args, ctx);
          void writeAudit(ctx, def.name, "ok", Date.now() - t0);
          return out;
        } catch (e: any) {
          void writeAudit(ctx, def.name, "error", Date.now() - t0, String(e?.message));
          return { error: String(e?.message || e) };
        }
      },
    });
  }
  return map;
}

function getModel() {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("Missing LOVABLE_API_KEY");
  const gateway = createLovableAiGatewayProvider(key);
  return gateway("google/gemini-3.6-flash");
}

/** One-shot reply (Telegram, Alexa AskIntent). Returns final text. */
export async function brainReply(
  ctx: ToolCtx,
  userText: string,
  opts?: { channel?: "telegram" | "alexa" | "chat"; history?: ModelMessage[] },
): Promise<string> {
  const defs = await getToolsForDevice(ctx);
  const tools = buildTools(ctx, defs);
  const channelHint =
    opts?.channel === "alexa"
      ? "\n\nDu antwortest über Alexa Sprachausgabe. Halte die Antwort unter 2 Sätzen, keine Markdown-Zeichen."
      : opts?.channel === "telegram"
      ? "\n\nDu antwortest im Telegram-Chat. Kurz, freundlich, Markdown erlaubt."
      : "";

  const result = await generateText({
    model: getModel(),
    system: SYSTEM_PROMPT + channelHint,
    messages: [...(opts?.history ?? []), { role: "user", content: userText }],
    tools,
    stopWhen: stepCountIs(50),
  });
  return result.text?.trim() || "Ich habe leider keine Antwort formuliert.";
}

/** Streaming chat handler for /api/chat (UIMessage[] in → UI stream out). */
export async function brainStream(ctx: ToolCtx, messages: UIMessage[]) {
  const defs = await getToolsForDevice(ctx);
  const tools = buildTools(ctx, defs);

  const result = streamText({
    model: getModel(),
    system: SYSTEM_PROMPT + "\n\nDu antwortest im Chat-Interface, Markdown erlaubt.",
    messages: await convertToModelMessages(messages),
    tools,
    stopWhen: stepCountIs(50),
  });
  return result.toUIMessageStreamResponse({ originalMessages: messages });
}
