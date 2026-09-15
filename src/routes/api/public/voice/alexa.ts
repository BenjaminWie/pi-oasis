// Alexa Custom Skill endpoint. Stateless: the access token is an HMAC-signed
// token issued by the OAuth routes, and every action is resolved against the
// Pi's self-announced endpoint catalogue.
import { createFileRoute } from "@tanstack/react-router";
import { bearer, jsonResponse } from "@/lib/agent-api.server";
import { verifyToken } from "@/lib/stateless-token.server";
import {
  endpointList,
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
            ask("Pi Control ist bereit. Sage zum Beispiel: Pumpe einschalten für fünf Minuten."),
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
          if (intent === "ListEndpointsIntent" || intent === "WaterPlanIntent") {
            return jsonResponse(ask((await endpointList()).speech));
          }
          if (intent === "EnergyAskIntent" || intent === "TibberPriceIntent") {
            return jsonResponse(ask((await energyPriceNow(ctx)).speech));
          }
          if (intent === "AMAZON.HelpIntent") {
            return jsonResponse(
              ask(
                "Du kannst sagen: Pumpe einschalten, Pumpe ausschalten, Status, welche Endpunkte gibt es, oder frag einfach frei.",
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
