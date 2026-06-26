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
  const tool = findTool(name);
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
            const first = plugins?.result?.plugins?.[0] ?? plugins?.plugins?.[0];
            if (!first) return jsonResponse(ask("Es ist keine Pumpe eingerichtet."));
            const minutes = Math.max(1, Math.min(120, Number(slot("Minutes") ?? 5)));
            await runTool(ctx, "pump_set", { id: first.id, action: "on", minutes });
            return jsonResponse(ask(`Okay, ${first.name} läuft für ${minutes} Minuten.`));
          }
          if (intent === "TurnOffPumpIntent" || intent === "PumpOffIntent") {
            const plugins = (await runTool(ctx, "list_plugins", {})) as any;
            const first = plugins?.result?.plugins?.[0] ?? plugins?.plugins?.[0];
            if (!first) return jsonResponse(ask("Es ist keine Pumpe eingerichtet."));
            await runTool(ctx, "pump_set", { id: first.id, action: "off" });
            return jsonResponse(ask(`Okay, ${first.name} ausgeschaltet.`));
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
            const first = plugins?.result?.plugins?.[0] ?? plugins?.plugins?.[0];
            if (!first) return jsonResponse(ask("Es ist keine Pumpe eingerichtet."));
            const det = (await runTool(ctx, "get_plugin", { id: first.id })) as any;
            const plan = det?.result?.plan ?? det?.plan;
            const rationale = plan?.rationale || "Kein aktueller Plan.";
            return jsonResponse(ask(`Plan für ${first.name}: ${rationale}`));
          }
          if (intent === "AMAZON.HelpIntent") {
            return jsonResponse(
              ask(
                "Du kannst sagen: Pumpe einschalten, Pumpe ausschalten, Status, oder erkläre den Plan.",
                false,
              ),
            );
          }
          if (intent === "AMAZON.StopIntent" || intent === "AMAZON.CancelIntent") {
            return jsonResponse(ask("Tschüss.", true));
          }
          return jsonResponse(ask("Das habe ich noch nicht gelernt."));
        } catch (e: any) {
          return jsonResponse(ask(`Fehler: ${String(e?.message || e).slice(0, 120)}`));
        }
      },
    },
  },
});
