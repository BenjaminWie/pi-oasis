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
  type IntentResult,
} from "@/lib/voice-intents.server";

/** Alexa requires requests to be rejected when the timestamp drifts too far. */
const MAX_SKEW_MS = 150_000;

function ask(text: string, end = true) {
  return {
    version: "1.0",
    response: { outputSpeech: { type: "PlainText", text }, shouldEndSession: end },
  };
}

/** Ask back for a slot value instead of guessing. */
function elicit(slot: string, intentName: string, text: string) {
  return {
    version: "1.0",
    response: {
      outputSpeech: { type: "PlainText", text },
      shouldEndSession: false,
      directives: [
        { type: "Dialog.ElicitSlot", slotToElicit: slot, updatedIntent: { name: intentName, slots: {} } },
      ],
    },
  };
}

/** Honest speech: never claim success when the Pi did not answer. */
function speak(r: IntentResult) {
  if (r.ok) return ask(r.speech);
  return ask(r.speech || "Der Pi antwortet gerade nicht. Bitte später noch einmal versuchen.");
}

async function log(dir: "in" | "out" | "error", what: string, detail?: unknown) {
  try {
    const { debugLog } = await import("@/lib/registry.server");
    debugLog(dir, what, detail, "alexa");
  } catch {
    /* best effort */
  }
}

export const Route = createFileRoute("/api/public/voice/alexa")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = bearer(request);
        const claims = verifyToken(token, "access");
        if (!claims) {
          await log("error", "Skill-Aufruf ohne gültige Verknüpfung");
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

        // Skill identity: only the configured skill may drive this Pi.
        const expectedSkill = process.env.PIHUB_ALEXA_SKILL_ID;
        const gotSkill = body?.context?.System?.application?.applicationId ?? body?.session?.application?.applicationId;
        if (expectedSkill && gotSkill && gotSkill !== expectedSkill) {
          await log("error", "Fremde Skill-Kennung abgewiesen", { gotSkill });
          return jsonResponse(ask("Dieser Skill darf den Pi nicht steuern."), 403);
        }

        // Timestamp window (Alexa security requirement).
        const ts = body?.request?.timestamp ? Date.parse(body.request.timestamp) : NaN;
        if (Number.isFinite(ts) && Math.abs(Date.now() - ts) > MAX_SKEW_MS) {
          await log("error", "Anfrage zu alt", { timestamp: body?.request?.timestamp });
          return jsonResponse(ask("Die Anfrage ist zu alt."), 400);
        }

        const type = body?.request?.type;
        if (type === "LaunchRequest") {
          return jsonResponse(
            ask(
              "Pi Control ist bereit. Sage zum Beispiel: bewässere fünf Minuten, oder: wie ist der Status?",
              false,
            ),
          );
        }
        if (type === "SessionEndedRequest") return jsonResponse(ask("", true));
        if (type !== "IntentRequest") return jsonResponse(ask("Das verstehe ich noch nicht."));

        const intent = body.request.intent?.name as string;
        const slots = body.request.intent?.slots ?? {};
        const slot = (n: string) => slots[n]?.value as string | undefined;
        const target = slot("Endpoint") || slot("PluginName") || slot("Device");
        await log("in", `Alexa-Intent ${intent}`, { target, scopes });

        if (!ctx.allowControl && /TurnOn|TurnOff|Irrigate|NightQuiet|Strategy|PumpOn|PumpOff/.test(intent ?? "")) {
          return jsonResponse(
            ask("Die Verknüpfung erlaubt nur Abfragen. Bitte den Skill mit Steuerrechten neu verknüpfen."),
          );
        }

        try {
          if (intent === "TurnOnPumpIntent" || intent === "PumpOnIntent") {
            const raw = slot("Minutes");
            const minutes = Number(raw ?? 5);
            if (raw !== undefined && !Number.isFinite(minutes)) {
              return jsonResponse(elicit("Minutes", intent, "Für wie viele Minuten?"));
            }
            const r = target
              ? await endpointSet(ctx, target, minutes || true)
              : await pumpOn(ctx, minutes);
            return jsonResponse(speak(r));
          }
          if (intent === "TurnOffPumpIntent" || intent === "PumpOffIntent") {
            const r = target ? await endpointSet(ctx, target, false) : await pumpOff(ctx);
            return jsonResponse(speak(r));
          }
          if (intent === "PumpStatusIntent") {
            return jsonResponse(speak(await pumpStatus(ctx)));
          }
          if (intent === "StatusIntent") {
            const r = target ? await endpointStatus(ctx, target) : await systemStatus(ctx);
            return jsonResponse(speak(r));
          }
          if (intent === "IrrigateIntent" || intent === "StartIrrigationIntent") {
            const raw = slot("Minutes");
            if (raw === undefined) {
              return jsonResponse(elicit("Minutes", intent, "Wie lange soll ich bewässern?"));
            }
            const minutes = Number(raw);
            if (!Number.isFinite(minutes)) {
              return jsonResponse(elicit("Minutes", intent, "Bitte sage die Minuten als Zahl."));
            }
            return jsonResponse(speak(await irrigationStart(ctx, minutes)));
          }
          if (intent === "NightQuietIntent") {
            const state = (slot("State") || "").toLowerCase();
            const on = ["an", "ein", "on", "aktiv"].includes(state)
              ? true
              : ["aus", "off", "inaktiv"].includes(state)
                ? false
                : undefined;
            return jsonResponse(speak(await nightQuiet(ctx, on)));
          }
          if (intent === "StrategyIntent") {
            return jsonResponse(speak(await strategy(ctx, slot("Strategy"))));
          }
          if (intent === "RainIntent") {
            return jsonResponse(speak(await rainForecast(ctx)));
          }
          if (intent === "SurplusIntent" || intent === "SolarIntent") {
            return jsonResponse(speak(await surplusNow(ctx)));
          }
          if (intent === "ListEndpointsIntent" || intent === "WaterPlanIntent") {
            return jsonResponse(speak(await endpointList()));
          }
          if (intent === "EnergyAskIntent" || intent === "TibberPriceIntent") {
            return jsonResponse(speak(await energyPriceNow(ctx)));
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
            (intent === "AskIntent" || intent === "FreeQuestionIntent" || intent === "AMAZON.FallbackIntent"
              ? ""
              : null);
          if (question === "") return jsonResponse(ask("Was möchtest du wissen?", false));
          if (question) {
            const direct = await routeText(ctx, String(question));
            if (direct) return jsonResponse(speak({ ...direct, speech: direct.speech.slice(0, 600) }));
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
          const msg = String(e?.message || e);
          await log("error", "Intent fehlgeschlagen", { intent, msg });
          return jsonResponse(ask(`Der Pi konnte das nicht ausführen: ${msg.slice(0, 120)}`));
        }
      },
    },
  },
});
