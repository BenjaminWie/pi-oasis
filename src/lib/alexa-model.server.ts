// Builds the German Alexa interaction model from the endpoints the Pi announced.
// Server-only, DATABASE-FREE: the slot values come straight from the live
// catalogue, so a new switch in Node-RED becomes speakable after one download.

import { getPiEndpoints } from "@/lib/pi-relay.server";

const INVOCATION = (process.env.PIHUB_ALEXA_INVOCATION || "pi control").toLowerCase();

function slotValue(name: string) {
  return { name: { value: name } };
}

function intent(name: string, samples: string[], slots?: { name: string; type: string }[]) {
  return { name, slots: slots ?? [], samples };
}

/** Speakable aliases for one endpoint (label first, id as fallback). */
function endpointNames(id: string, label?: string): string[] {
  const out = new Set<string>();
  if (label) out.add(label.toLowerCase());
  out.add(id.replace(/[_\-.]+/g, " ").toLowerCase());
  return [...out].filter((s) => /^[a-zäöüß0-9 ]{2,40}$/.test(s));
}

export async function buildAlexaModel(via = "alexa") {
  const cat = await getPiEndpoints(via);
  const endpoints = cat.data?.endpoints ?? [];

  const endpointValues = endpoints.flatMap((e) => endpointNames(e.id, e.label)).map(slotValue);
  const strategyValues = [
    ...new Set(
      endpoints
        .filter((e) => /strateg/i.test(e.id))
        .flatMap((e) => e.options ?? [])
        .concat(["automatik", "überschuss", "immer", "aus"]),
    ),
  ].map((v) => slotValue(String(v).toLowerCase()));

  return {
    interactionModel: {
      languageModel: {
        invocationName: INVOCATION,
        types: [
          {
            name: "PC_ENDPOINT",
            values: endpointValues.length ? endpointValues : [slotValue("pumpe")],
          },
          {
            name: "PC_STATE",
            values: ["an", "aus", "ein", "off", "on"].map(slotValue),
          },
          { name: "PC_STRATEGY", values: strategyValues },
        ],
        intents: [
          { name: "AMAZON.HelpIntent", samples: [] },
          { name: "AMAZON.StopIntent", samples: [] },
          { name: "AMAZON.CancelIntent", samples: [] },
          { name: "AMAZON.FallbackIntent", samples: [] },
          intent(
            "TurnOnPumpIntent",
            [
              "schalte die pumpe ein",
              "pumpe an",
              "pumpe einschalten",
              "pumpe für {Minutes} minuten",
              "schalte {Endpoint} ein",
              "schalte {Endpoint} für {Minutes} minuten ein",
            ],
            [
              { name: "Minutes", type: "AMAZON.NUMBER" },
              { name: "Endpoint", type: "PC_ENDPOINT" },
            ],
          ),
          intent(
            "TurnOffPumpIntent",
            ["schalte die pumpe aus", "pumpe aus", "pumpe ausschalten", "schalte {Endpoint} aus"],
            [{ name: "Endpoint", type: "PC_ENDPOINT" }],
          ),
          intent("PumpStatusIntent", ["läuft die pumpe", "wie läuft die pumpe", "pumpenstatus"]),
          intent(
            "StatusIntent",
            ["status", "wie ist der status", "wie geht es dem pi", "status von {Endpoint}"],
            [{ name: "Endpoint", type: "PC_ENDPOINT" }],
          ),
          intent(
            "IrrigateIntent",
            [
              "bewässere",
              "bewässere {Minutes} minuten",
              "gieße {Minutes} minuten",
              "starte die bewässerung für {Minutes} minuten",
            ],
            [{ name: "Minutes", type: "AMAZON.NUMBER" }],
          ),
          intent(
            "NightQuietIntent",
            ["nachtruhe", "nachtruhe {State}", "schalte die nachtruhe {State}"],
            [{ name: "State", type: "PC_STATE" }],
          ),
          intent(
            "StrategyIntent",
            ["strategie", "welche strategie läuft", "setze strategie auf {Strategy}", "strategie {Strategy}"],
            [{ name: "Strategy", type: "PC_STRATEGY" }],
          ),
          intent("RainIntent", ["wie viel regen kommt", "regnet es bald", "regen vorhersage"]),
          intent("SurplusIntent", [
            "wie hoch ist der überschuss",
            "wie viel solarstrom ist übrig",
            "pv überschuss",
          ]),
          intent("ListEndpointsIntent", [
            "was kannst du steuern",
            "welche endpunkte gibt es",
            "welche werte hast du",
          ]),
          intent("EnergyAskIntent", ["was kostet der strom", "wie hoch ist der strompreis", "strompreis"]),
          intent(
            "AskIntent",
            ["frage {Question}", "sag mir {Question}", "{Question}"],
            [{ name: "Question", type: "AMAZON.SearchQuery" }],
          ),
        ],
      },
    },
  };
}
