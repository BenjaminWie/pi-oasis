// AI diagnosis for Pi Control: logs + endpoint config → likely cause + steps.
import { streamText } from "ai";
import { createLovableAiGatewayProvider } from "./ai-gateway.server";

const SYSTEM = `Du bist der Diagnose-Assistent von Pi Control. Aufbau der Anlage:
- Raspberry Pi mit lokaler Pi-Control-App (Steuerung, Feintuning, Debug), Node-RED meldet Endpunkte per HTTP an (announce) und liefert Werte; Befehle gehen an Node-RED http-in oder MQTT.
- Cloud ist nur Router: Relay über Tunnel, Alexa (OAuth-Verknüpfung, Skill-Endpoint), Telegram-Webhook, KI-Assistent.
- Lokaler 48-h-JSONL-Speicher, Debug-Ring mit Kanälen node-red, alexa, telegram, chat, rules, local.

Antworte immer auf Deutsch in genau diesem Markdown-Aufbau:
## Wahrscheinliche Ursache
Ein Satz, danach "Sicherheit: hoch/mittel/gering".
## Weitere mögliche Ursachen
Kurze Liste.
## Lösungsschritte
Nummeriert, konkret (Befehle in Code-Blöcken), jeder Schritt mit "Danach solltest du sehen: …".
## Betroffene Endpunkte oder Einstellungen
Nur echte IDs aus der mitgeschickten Konfiguration, sonst "Keine erkennbar".

Erfinde keine Endpunkte oder Werte. Reichen die Angaben nicht, sag das offen und nenne, welche Zeilen fehlen.`;

export function diagnoseStream(input: {
  logs: string;
  attempted?: string;
  config?: unknown;
}) {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("Missing LOVABLE_API_KEY");
  const prompt = [
    input.attempted ? `Was versucht wurde:\n${input.attempted}` : "",
    `Fehlerprotokoll:\n\`\`\`\n${input.logs}\n\`\`\``,
    input.config
      ? `Endpunkt-Konfiguration (JSON):\n\`\`\`json\n${JSON.stringify(input.config).slice(0, 15000)}\n\`\`\``
      : "Keine Endpunkt-Konfiguration mitgeschickt.",
  ]
    .filter(Boolean)
    .join("\n\n");
  return streamText({
    model: createLovableAiGatewayProvider(key)("google/gemini-3.8-flash"),
    system: SYSTEM,
    prompt,
    maxRetries: 0,
  });
}
