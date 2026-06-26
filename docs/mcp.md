# Pi-Hub MCP Server

Connect any AI (ChatGPT, Gemini, Claude, Alexa, custom agents) to your Pi
via the hosted MCP endpoint. The cloud relay buffers commands so the Pi
stays behind your router — no port forwarding, no public IP, no DNS hustle.

## Endpoint

```
POST https://pi-hub.benniwie.com/api/public/mcp
Authorization: Bearer <your-mcp-token>
Content-Type: application/json
```

Transport: MCP Streamable HTTP (JSON-RPC 2.0 over HTTP POST).

## Get a token

1. Sign in at <https://pi-hub.benniwie.com/cloud/mcp>.
2. Pair a device under **Geräte** if you haven't yet.
3. Open **MCP**, click **Neu**, pick the device, choose scopes:
   - **read** (default) — query status, plugins, events.
   - **control** — also toggle the pump, restart containers, publish MQTT.
4. Copy the token (shown **once**). Store it in your AI client.

## Tools exposed

| Tool | Scope | What it does |
| --- | --- | --- |
| `get_device_info` | read | Cached snapshot (no round-trip) |
| `get_status` | read | Fresh CPU/RAM/temp/disk from the Pi |
| `list_containers` | read | Docker containers on the Pi |
| `container_action` | control | start / stop / restart a container |
| `list_plugins` | read | All Pi plugins |
| `get_plugin` | read | One plugin + AI plan + decisions |
| `run_planner_now` | control | Rebuild the watering plan (weather + AI) |
| `pump_set` | control | Manual ON/OFF with minutes |
| `mqtt_publish` | control | Raw MQTT publish |
| `list_recent_events` | read | Recent Node-RED / sensor events |

## Client configs

### Claude Desktop (`~/Library/Application Support/Claude/claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "pi-hub": {
      "url": "https://pi-hub.benniwie.com/api/public/mcp",
      "headers": { "Authorization": "Bearer mcp_xxx…" }
    }
  }
}
```

### ChatGPT (Custom GPT)

In the GPT editor, add an **Action** → **Import from URL**, paste
`https://pi-hub.benniwie.com/api/public/mcp`, and set authentication to
**Bearer** with your token. ChatGPT will discover the tool list via
`tools/list`.

### Gemini / Google AI Studio (function calling)

Use the MCP URL as a tool server. Pass the bearer token in
`Authorization`. Gemini extensions that speak MCP Streamable HTTP work
out of the box.

### Generic test (curl)

```bash
TOKEN=mcp_xxx
URL=https://pi-hub.benniwie.com/api/public/mcp

# Discover tools
curl -s -X POST $URL \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | jq

# Read status
curl -s -X POST $URL \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call",
       "params":{"name":"get_status","arguments":{}}}' | jq

# Pump on for 5 minutes
curl -s -X POST $URL \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call",
       "params":{"name":"pump_set",
                 "arguments":{"id":"<plugin-id>","action":"on","minutes":5}}}' | jq
```

## Alexa skill

Endpoint for the Alexa Custom Skill HTTPS handler:

```
https://pi-hub.benniwie.com/api/public/voice/alexa
```

In the Alexa developer console:
1. Create a Custom Skill, language **German (DE)**.
2. Account Linking → **Auth Code Grant** isn't supported here; pick
   **Send Alexa user's bearer token** style and paste an MCP token
   (scope `read,control`) as the access token.
3. Endpoint: HTTPS, the URL above, certificate "My development
   endpoint is a sub-domain of a domain that has a wildcard certificate
   from a CA".
4. Add intents (sample invocation in German):
   - `TurnOnPumpIntent` — "schalte die Pumpe ein", "Pumpe an für {Minutes} Minuten"
   - `TurnOffPumpIntent` — "schalte die Pumpe aus"
   - `PumpStatusIntent` — "wie ist der Status"
   - `WaterPlanIntent` — "erkläre den Plan"
   Add an `AMAZON.NUMBER` slot named `Minutes` on the on-intent.

The skill speaks German responses ("Okay, läuft für 5 Minuten").

## Security

- Tokens are stored hashed (SHA-256) — the raw value is shown once.
- Each token is scoped to **one device** and the scopes you chose.
- Every call is written to `mcp_audit` (visible in the MCP page).
- HTTPS-only; the Pi only ever talks **outbound** to the cloud.
- Control tools validate inputs server-side again (Zod) before
  enqueueing — there is no shell interpolation path.
- Pump safety caps (max minutes/day, min hours between runs) are
  enforced by the Pi-side plugin runner; MCP `pump_set` cannot
  override them.
- Revoke a token any time → its next call returns 401.
