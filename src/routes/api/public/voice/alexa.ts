// Minimal Alexa Custom Skill endpoint that maps voice intents to MCP tools.
// Auth: Alexa account linking issues a Bearer access token (use an MCP token
// with 'control' scope). The skill speaks German responses by default.
//
// Note: Amazon also expects request signature validation in production.
// For a personal skill linked to a single household account, Bearer-token
// + HTTPS is the security boundary used here; add cert-chain validation
// before publishing the skill publicly.

import { createFileRoute } from "@tanstack/react-router";
import { bearer, jsonResponse } from "@/lib/agent-api.server";
import { findTool, resolveToken, writeAudit, type ToolCtx } from "@/lib/mcp-tools.server";

function ask(text: string, end = true) {
  return {
    version: "1.0",
    response: {
      outputSpeech: { type: "PlainText", text },
      shouldEndSession: end,
    },
  };
}

async function runTool(ctx: ToolCtx, name: string, args: Record<string, unknown>) {
  const tool = await findTool(name, ctx);
  if (!tool) throw new Error("unknown tool " + name);
  if (!ctx.scopes.includes(tool.scope)) throw new Error("missing scope " + tool.scope);
  const parsed = tool.inputSchema.parse(args);
  const t0 = Date.now();
  try {
    const out = await tool.execute(parsed, ctx);
    await writeAudit(ctx, tool.name, "ok", Date.now() - t0);
    return out as any;
  } catch (e: any) {
    await writeAudit(ctx, tool.name, "error", Date.now() - t0, String(e?.message));
    throw e;
  }
}

export const Route = createFileRoute("/api/public/voice/alexa")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = bearer(request);
        if (!token) return jsonResponse(ask("Bitte zuerst dein Pi-Hub-Konto verknüpfen."), 401);
        const r = await resolveToken(token);
        if (!r.ok) return jsonResponse(ask("Verknüpfung ungültig oder abgelaufen."), 401);
        const ctx = r.ctx;

        let body: any;
        try {
          body = await request.json();
        } catch {
          return jsonResponse(ask("Anfrage konnte nicht gelesen werden."), 400);
        }

        const type = body?.request?.type;
        if (type === "LaunchRequest") {
          return jsonResponse(
            ask("Pi-Hub ist bereit. Sage zum Beispiel: Pumpe einschalten für fünf Minuten."),
          );
        }
        if (type === "SessionEndedRequest") {
          return jsonResponse(ask("", true));
        }

        if (type !== "IntentRequest") {
          return jsonResponse(ask("Das verstehe ich noch nicht."));
        }

        const intent = body.request.intent?.name as string;
        const slots = body.request.intent?.slots ?? {};
        const slot = (n: string) => slots[n]?.value as string | undefined;

        try {
          if (intent === "TurnOnPumpIntent" || intent === "PumpOnIntent") {
            const plugins = (await runTool(ctx, "list_plugins", {})) as any;
            const list = plugins?.result?.plugins ?? plugins?.plugins ?? [];
            const targetName = slot("PluginName");
            const target = targetName
              ? list.find((p: any) => p.name.toLowerCase().includes(targetName.toLowerCase()))
              : list[0];

            if (!target) return jsonResponse(ask("Ich konnte das gewünschte Plugin nicht finden."));

            const minutes = Math.max(1, Math.min(120, Number(slot("Minutes") ?? 5)));
            await runTool(ctx, "pump_set", { id: target.id, action: "on", minutes });
            return jsonResponse(ask(`Okay, ${target.name} läuft für ${minutes} Minuten.`));
          }
          if (intent === "TurnOffPumpIntent" || intent === "PumpOffIntent") {
            const plugins = (await runTool(ctx, "list_plugins", {})) as any;
            const list = plugins?.result?.plugins ?? plugins?.plugins ?? [];
            const targetName = slot("PluginName");
            const target = targetName
              ? list.find((p: any) => p.name.toLowerCase().includes(targetName.toLowerCase()))
              : list[0];

            if (!target) return jsonResponse(ask("Ich konnte das gewünschte Plugin nicht finden."));

            await runTool(ctx, "pump_set", { id: target.id, action: "off" });
            return jsonResponse(ask(`Okay, ${target.name} ausgeschaltet.`));
          }
          if (intent === "PumpStatusIntent" || intent === "StatusIntent") {
            const snap = (await runTool(ctx, "get_status", {})) as any;
            const r = snap?.result ?? snap;
            if (!r) return jsonResponse(ask("Status nicht verfügbar."));
            return jsonResponse(
              ask(
                `CPU ${Math.round(r.cpu ?? 0)} Prozent, Temperatur ${Math.round(r.temp ?? 0)} Grad. ${
                  r.containers?.length ?? 0
                } Container laufen.`,
              ),
            );
          }
          if (intent === "WaterPlanIntent" || intent === "PlanIntent") {
            const plugins = (await runTool(ctx, "list_plugins", {})) as any;
            const list = plugins?.result?.plugins ?? plugins?.plugins ?? [];
            const targetName = slot("PluginName");
            const target = targetName
              ? list.find((p: any) => p.name.toLowerCase().includes(targetName.toLowerCase()))
              : list[0];

            if (!target) return jsonResponse(ask("Plugin nicht gefunden."));

            const det = (await runTool(ctx, "get_plugin", { id: target.id })) as any;
            const plan = det?.result?.plan ?? det?.plan;
            const rationale = plan?.rationale || "Kein aktueller Plan.";
            return jsonResponse(ask(`Plan für ${target.name}: ${rationale}`));
          }
          if (intent === "PluginCommandIntent") {
            const command = slot("CommandName");
            const pluginName = slot("PluginName");
            if (!command) return jsonResponse(ask("Welchen Befehl soll ich ausführen?"));

            const plugins = (await runTool(ctx, "list_plugins", {})) as any;
            const list = plugins?.result?.plugins ?? plugins?.plugins ?? [];

            // Try to find matching plugin and command
            for (const p of list) {
              if (pluginName && !p.name.toLowerCase().includes(pluginName.toLowerCase())) continue;
              if (!p.commands) continue;
              const c = p.commands.find((c: any) =>
                c.label.toLowerCase().includes(command.toLowerCase()) ||
                c.name.toLowerCase().includes(command.toLowerCase())
              );
              if (c) {
                const toolName = `${p.name.toLowerCase().replace(/\s+/g, "_")}_${c.name.toLowerCase()}`;
                await runTool(ctx, toolName, { minutes: Number(slot("Minutes") || 5) });
                return jsonResponse(ask(`Befehl ${c.label} für ${p.name} ausgeführt.`));
              }
            }
            return jsonResponse(ask(`Ich konnte den Befehl ${command} nicht finden.`));
          }
          if (intent === "LaundryDoneIntent") {
            const appliance = slot("Appliance") || "Waschmaschine";
            const r = (await runTool(ctx, "infer_appliance_state", {
              appliance,
              window_minutes: 180,
            })) as any;
            if (r?.available === false) {
              return jsonResponse(
                ask(
                  `Ich habe noch keine Stromdaten für ${appliance}. Schau, ob Tibber Pulse oder Tasmota pusht.`,
                ),
              );
            }
            if (r.finished) {
              return jsonResponse(
                ask(
                  `Ja, ${r.appliance} ist seit ${r.idle_since_min} Minuten fertig. Letzter Wert ${Math.round(r.last_watts)} Watt.`,
                ),
              );
            }
            if (r.running) {
              return jsonResponse(
                ask(
                  `Nein, ${r.appliance} läuft noch. Aktuell ${Math.round(r.last_watts)} Watt, seit ${r.runtime_min} Minuten.`,
                ),
              );
            }
            return jsonResponse(
              ask(`Aktuell sehe ich keinen Lauf für ${appliance}. Letzte Werte sind im Leerlauf.`),
            );
          }
          if (intent === "EnergyAskIntent" || intent === "TibberPriceIntent") {
            const p = (await runTool(ctx, "get_tibber_price_now", {})) as any;
            if (!p?.available) return jsonResponse(ask("Mir fehlen aktuelle Tibber-Daten."));
            return jsonResponse(
              ask(
                `Strom kostet gerade ${Number(p.tibber_ct_per_kwh).toFixed(1)} Cent pro Kilowattstunde.`,
              ),
            );
          }
          if (intent === "AMAZON.HelpIntent") {
            return jsonResponse(
              ask(
                "Du kannst sagen: Pumpe einschalten, Pumpe ausschalten, Status, ist meine Wäsche fertig, oder wie teuer ist Strom gerade.",
                false,
              ),
            );
          }
          if (intent === "AskIntent" || intent === "FreeQuestionIntent") {
            const question = slot("Question") || slot("Query") || slot("Text");
            if (!question) return jsonResponse(ask("Was möchtest du wissen?", false));
            try {
              const { brainReply } = await import("@/lib/assistant-brain.server");
              const answer = await brainReply(ctx, question, { channel: "alexa" });
              return jsonResponse(ask(answer.slice(0, 600)));
            } catch (e: any) {
              return jsonResponse(ask(`Fehler: ${String(e?.message || e).slice(0, 120)}`));
            }
          }
          if (intent === "AMAZON.StopIntent" || intent === "AMAZON.CancelIntent") {
            return jsonResponse(ask("Tschüss.", true));
          }
          // Fallback: forward the raw utterance as a free question if present
          const raw = body.request.intent?.slots?.Query?.value || body.request.intent?.slots?.Text?.value;
          if (raw) {
            try {
              const { brainReply } = await import("@/lib/assistant-brain.server");
              const answer = await brainReply(ctx, String(raw), { channel: "alexa" });
              return jsonResponse(ask(answer.slice(0, 600)));
            } catch { /* fallthrough */ }
          }
          return jsonResponse(ask("Das habe ich noch nicht gelernt."));
        } catch (e: any) {
          return jsonResponse(ask(`Fehler: ${String(e?.message || e).slice(0, 120)}`));
        }
      },
    },
  },
});
