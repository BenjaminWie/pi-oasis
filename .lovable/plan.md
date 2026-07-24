
## Validation der Vorschläge aus dem Chat

Bewertet gegen den aktuellen Code (`voice-intents.server.ts`, `mcp-tools.server.ts`, `telegram/webhook.$userId.ts`, `voice/alexa.ts`, `mcp.ts`):

- **„Stufe 1 Pattern-Matching"** — stimmt. Telegram macht heute Regex + einen Gemini-Aufruf, der nur einen `/pump …`-String zurückgibt; Alexa mappt Slots 1:1 auf `pumpOn/pumpOff/pumpStatus`. Kein Gedächtnis, keine Rückfragen, kein „warum".
- **„Tools existieren schon"** — stimmt. `mcp-tools.server.ts` hat `get_status`, `get_power_history`, `get_tibber_price_now`, `infer_appliance_state`, `pump_set`, `mqtt_publish`, `list_recent_events`, `run_planner_now` etc. Der Vorschlag „LLM mit Function-Calling drüberlegen" muss **nichts neu bauen** — nur diese Tools an ein Chat-Modell hängen.
- **„Node-RED als Erklär-Maschine (`strategy_applied` / reason-Message)"** — stimmt und liegt bereits in `device_state_latest.strategy_applied` + `device_events.metrics`. Das LLM muss sie nur lesen.
- **„MCP-Server für Node-RED"** — für unser Ziel unnötig. Wir haben schon einen MCP-Server (`/api/public/mcp`) mit Zugriff auf denselben State. Wir bleiben Zero-Wake, indem das LLM ausschließlich Cloud-Reads (Supabase) + bestehende `enqueue`-Pfade nutzt.
- **„OpenAI/Anthropic vs. lokale KI"** — überflüssige Wahl. Wir nutzen den **Lovable AI Gateway** (Default `openai/gpt-5.5`, Key liegt schon als `LOVABLE_API_KEY`), das ist per Knowledge-File die vorgeschriebene Route und kostet keine zusätzliche Provider-Anbindung.

Zusammengefasst: Der Vorschlag ist richtig, aber er kann **schlanker** umgesetzt werden — kein separater Edge-Function-Endpoint, kein neuer Provider, kein Node-RED-MCP. Ein einziger „Brain"-Server-Fn, den Alexa, Telegram und das neue UI-Chat gemeinsam nutzen.

## Ziel

Ein Chat-Interface im Pi-Hub UI (Cloud-Seite) **und** derselbe LLM-Brain hinter Alexa/Telegram. Der Brain nutzt die vorhandenen MCP-Tools als Function-Calls, hat Kurzzeit-Gedächtnis pro Konversation und respektiert Zero-Wake (Reads gehen an Supabase, Writes an `agent_commands` + `broadcastCommandWake`).

## Architektur

```text
             ┌───────────────────────── Chat-UI (/connections/assistant) ─┐
             │                                                            │
Alexa ──┐    │  useChat  ──POST──►  /api/chat  ──► streamText            │
Telegram┼──► brainReply(ctx, text, history)                              │
Pi-Hub ─┘         │                                                     │
                  ▼                                                      │
        Lovable AI Gateway (openai/gpt-5.5)                              │
        tools = wrap(mcp-tools.server.ts)                                │
                  │                                                     │
                  ├─ read tools: get_status, get_power_history, ...     │
                  │  → Supabase read (Zero-Wake, kein audit)            │
                  └─ write tools: pump_set, mqtt_publish                │
                     → enqueue() + broadcastCommandWake() (bestehend)   │
```

Nur EIN LLM-Aufruf-Pfad, drei Aufrufer.

## Änderungen (Dateien)

1. **Neuer gemeinsamer Brain**: `src/lib/assistant-brain.server.ts`
   - Export `brainReply({ userId, deviceId, source, history, userText })` → `{ reply, toolCalls, updatedHistory }`.
   - Nutzt AI SDK (`ai`, `@ai-sdk/openai-compatible`) via `createLovableAiGatewayProvider` (siehe `ai-sdk-lovable-gateway`/`connecting-to-ai-models-tanstack`).
   - Baut `tools` aus `getToolsForDevice(ctx)` in `mcp-tools.server.ts`: jedes MCP-Tool wird zu einem AI-SDK-`tool({ description, inputSchema, execute })`. Zod-Schemas werden 1:1 wiederverwendet.
   - System-Prompt (deutsch, kurz): „Du bist der Pi-Hub-Assistent. Antworte knapp, nutze `get_status`/`get_power_history` bevor du erklärst, warum die Pumpe an/aus ist. Benutze `strategy_applied` und `reason`. Für Steuerbefehle rufe `pump_set` / `mqtt_publish` auf. Frage vor destruktiven Änderungen kurz nach."
   - `stopWhen: stepCountIs(50)`; alle Tool-Calls durch die vorhandenen `enqueue` + `broadcastCommandWake`-Pfade → Zero-Wake bleibt.

2. **Streaming-Chat-Route für UI**: `src/routes/api/chat.ts` (neu)
   - `createFileRoute("/api/chat")({ server: { handlers: { POST } } })`.
   - Nutzt `requireSupabaseAuth` per manueller Bearer-Prüfung (Route unter `/api/`, nicht `/api/public/`, damit nur eingeloggte User zugreifen).
   - Resolved `deviceId` via `resolveDefaultDevice(userId)`; ruft `streamText` mit `brainReply`-Tools; `toUIMessageStreamResponse()`.

3. **Chat-UI**: `src/routes/_cloud/connections.assistant.tsx` (neu)
   - `useChat({ transport: new DefaultChatTransport({ api: "/api/chat" }) })`, Rendering von `message.parts` mit `react-markdown` (bereits im Repo? — beim Bauen prüfen; wenn nicht: `bun add react-markdown`).
   - Zeigt Tool-Aktivität kompakt („🔧 get_status", „⚡ pump_set(10min)") und den finalen Text.
   - Verlauf clientseitig in `sessionStorage` (kein neues DB-Schema; Zero-Wake-freundlich).
   - Link-Karte in `connections.index.tsx` ergänzen: „Assistant — mit KI chatten".

4. **Telegram-Webhook** (`src/routes/api/public/telegram/webhook.$userId.ts`)
   - Slash-Befehle (`/pump on 10`, `/status`, …) bleiben **1:1 erhalten** als schneller, LLM-freier Pfad (spart Credits).
   - **Neu**: alles was **kein** `/`-Command ist (Freitext + transkribierte Voice) → `brainReply(ctx, text, historyForChat(chatId))` statt `mapVoiceToCommand`.
   - Kurzzeit-Historie pro `telegram_chat_id` in einer neuen kleinen In-Memory-Map (letzte 12 Turns, TTL 30 min) — kein DB-Schreiben, konsistent mit Zero-Wake.

5. **Alexa-Webhook** (`src/routes/api/public/voice/alexa.ts`)
   - Bestehende Intents (`PumpOn`, `PumpOff`, `PumpStatus`, `SystemStatus`, `PriceNow`) bleiben — Alexa braucht sub-2s Antworten und Zero-Auth-Roundtrips.
   - **Neu**: `AskIntent` (Slot `question`) → `brainReply(ctx, question, [])` mit `maxSteps: 3` und harter 4-s-Deadline; wenn Timeout → generische „Ich schaue nach und schicke dir das per Telegram"-Antwort und `brainReply` läuft „fire-and-forget" mit Telegram-Push.

6. **Node-RED-/Ingest-Angleich**: keine Änderung nötig. Der Brain liest die schon publizierten `strategy_applied`, `reason` und `device_events`-Zeilen. Kein neuer Endpoint, kein neues `pg_cron`.

## Zero-Wake / Credits-Impact

- Chat-UI-Turn: 1 LLM-Call + N Supabase-Reads. Keine neuen periodischen Wakes.
- Telegram-Freitext: 1 LLM-Call. Slash-Commands weiterhin ohne LLM.
- Alexa-`AskIntent`: 1 LLM-Call nur bei explizitem „Frage"-Intent.
- Tool-Executions gehen durch bereits existierende `enqueue`/`broadcast`-Pfade — kein zusätzliches DB-Polling.
- Erwartet: +0,05–0,15 Credits/Tag bei normaler Nutzung; bleibt innerhalb 0,5-Credit-Budget.

## Nicht Teil dieses Plans

- Kein `node-red-contrib-mcp-server` (Node-RED bleibt Actuator, MCP-Server bleiben wir in der Cloud).
- Keine neue Supabase Edge Function (Regel: TanStack `createServerFn` / server routes).
- Kein persistenter Chat-Verlauf in Supabase (Zero-Wake). Kann später als Opt-in nachgezogen werden.
- Kein Modelltausch, kein neuer Provider — Lovable AI Gateway, `openai/gpt-5.5`.

## Verifikation

- `tsgo` sauber.
- Chat-UI: „Warum läuft die Pumpe nicht?" → sichtbarer Tool-Call `get_status`, danach Antwort mit `strategy_applied`/`reason`.
- Chat-UI: „Mach die Pumpe 5 Min an" → Tool-Call `pump_set(minutes=5)`, `agent_commands`-Zeile via Supabase-Query sichtbar, `broadcastCommandWake` in Logs.
- Telegram-Freitext: „Warum steht die Pumpe?" → sinnvolle Antwort; `/pump on 10` weiterhin ohne LLM (Log-Beweis).
- Alexa: „Alexa, frage Pi-Hub warum die Pumpe steht" → Antwort ≤ 4 s oder Fallback-Speech.
- `list_ai_gateway_requests`: pro Testfrage genau ein Modell-Call, Modell = `openai/gpt-5.5`.
