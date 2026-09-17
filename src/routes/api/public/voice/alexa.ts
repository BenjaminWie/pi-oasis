// Alexa Custom Skill endpoint. Stateless: the access token is an HMAC-signed
// token issued by the OAuth routes, and every action is resolved against the
// Pi's self-announced endpoint catalogue.
import { createFileRoute } from "@tanstack/react-router";
import { bearer, jsonResponse } from "@/lib/agent-api.server";
import { verifyToken } from "@/lib/stateless-token.server";
import {
  endpointList,
  irrigationStart,
  nightQuiet,
  rainForecast,
  routeText,
  strategy,
  surplusNow,
  endpointSet,
  endpointStatus,
  energyPriceNow,
  pumpOff,
  pumpOn,
  pumpStatus,
  systemStatus,
  type IntentCtx,
} from "@/lib/voice-intents.server";

function ask(text: string, end = true) {
  return {
    version: "1.0",
    response: { outputSpeech: { type: "PlainText", text }, shouldEndSession: end },
  };
}

export const Route = createFileRoute("/api/public/voice/alexa")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = bearer(request);
        const claims = verifyToken(token, "access");
        if (!claims) {
          return jsonResponse(ask("Bitte zuerst dein Pi-Control-Konto verknüpfen."), 401);
        }
        const scopes = Array.isArray(claims.sc) ? (claims.sc as string[]) : ["read"];
        const ctx: IntentCtx = {
          source: "alexa",
          userId: claims.sub,
          allowControl: scopes.includes("control"),
        };

        let body: any;
        try {
          body = await request.json();
        } catch {
          return jsonResponse(ask("Anfrage konnte nicht gelesen werden."), 400);
        }

        const type = body?.request?.type;
        if (type === "LaunchRequest") {
          return jsonResponse(
            ask("Pi Control ist bereit. Sage zum Beispiel: bewässere fünf Minuten, oder: wie ist der Status?"),
          );
        }
        if (type === "SessionEndedRequest") return jsonResponse(ask("", true));
        if (type !== "IntentRequest") return jsonResponse(ask("Das verstehe ich noch nicht."));

        const intent = body.request.intent?.name as string;
        const slots = body.request.intent?.slots ?? {};
        const slot = (n: string) => slots[n]?.value as string | undefined;
        const target = slot("Endpoint") || slot("PluginName") || slot("Device");

        try {
          if (intent === "TurnOnPumpIntent" || intent === "PumpOnIntent") {
            const minutes = Number(slot("Minutes") ?? 5);
            const r = target
              ? await endpointSet(ctx, target, minutes || true)
              : await pumpOn(ctx, minutes);
            return jsonResponse(ask(r.speech));
          }
          if (intent === "TurnOffPumpIntent" || intent === "PumpOffIntent") {
            const r = target ? await endpointSet(ctx, target, false) : await pumpOff(ctx);
            return jsonResponse(ask(r.speech));
          }
          if (intent === "PumpStatusIntent") {
            return jsonResponse(ask((await pumpStatus(ctx)).speech));
          }
          if (intent === "StatusIntent") {
            const r = target ? await endpointStatus(ctx, target) : await systemStatus(ctx);
            return jsonResponse(ask(r.speech));
          }
          if (intent === "IrrigateIntent" || intent === "StartIrrigationIntent") {
            const minutes = Number(slot("Minutes") ?? 10);
            return jsonResponse(ask((await irrigationStart(ctx, minutes)).speech));
          }
          if (intent === "NightQuietIntent") {
            const state = (slot("State") || "").toLowerCase();
            const on = ["an", "ein", "on", "aktiv"].includes(state)
              ? true
              : ["aus", "off", "inaktiv"].includes(state)
                ? false
                : undefined;
            return jsonResponse(ask((await nightQuiet(ctx, on)).speech));
          }
          if (intent === "StrategyIntent") {
            return jsonResponse(ask((await strategy(ctx, slot("Strategy"))).speech));
          }
          if (intent === "RainIntent") {
            return jsonResponse(ask((await rainForecast(ctx)).speech));
          }
          if (intent === "SurplusIntent" || intent === "SolarIntent") {
            return jsonResponse(ask((await surplusNow(ctx)).speech));
          }
          if (intent === "ListEndpointsIntent" || intent === "WaterPlanIntent") {
            return jsonResponse(ask((await endpointList()).speech));
          }
          if (intent === "EnergyAskIntent" || intent === "TibberPriceIntent") {
            return jsonResponse(ask((await energyPriceNow(ctx)).speech));
          }
          if (intent === "AMAZON.HelpIntent") {
            return jsonResponse(
              ask(
                "Du kannst sagen: Pumpe einschalten, zehn Minuten bewässern, Nachtruhe an, Strategie Überschuss, wie viel Regen kommt, wie hoch ist der Überschuss, Status, oder frag einfach frei.",
                false,
              ),
            );
          }
          if (intent === "AMAZON.StopIntent" || intent === "AMAZON.CancelIntent") {
            return jsonResponse(ask("Tschüss.", true));
          }

          const question =
            slot("Question") ||
            slot("Query") ||
            slot("Text") ||
            (intent === "AskIntent" || intent === "FreeQuestionIntent" ? "" : null);
          if (question === "") return jsonResponse(ask("Was möchtest du wissen?", false));
          if (question) {
            const direct = await routeText(ctx, String(question));
            if (direct) return jsonResponse(ask(direct.speech.slice(0, 600)));
            const { brainReply } = await import("@/lib/assistant-brain.server");
            const answer = await brainReply(
              { source: "alexa", userId: claims.sub, allowControl: ctx.allowControl },
              String(question),
              { channel: "alexa" },
            );
            return jsonResponse(ask(answer.slice(0, 600)));
          }
          return jsonResponse(ask("Das habe ich noch nicht gelernt."));
        } catch (e: any) {
          return jsonResponse(ask(`Fehler: ${String(e?.message || e).slice(0, 120)}`));
        }
      },
    },
  },
});
