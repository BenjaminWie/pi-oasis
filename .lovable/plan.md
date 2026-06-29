## What I found

- The production logs show repeated `POST /api/public/cloud-bridge/event → 401`, while `/api/public/agent/poll → 204` is healthy. That means the Pi cloud bridge itself is connected, but the Node-RED event push is using the wrong/missing token.
- In your pasted flow, `CLOUD_DEVICE_TOKEN` is empty, one function has a hardcoded old token, and the HTTP request nodes have fixed URL/auth settings. Node-RED is warning that `msg.url`/`msg.headers` can no longer override those fixed node settings, so the function-generated request is being ignored.
- The local fallback URL is mixed up: it points to cloud-bridge-style routes, but local fallback should be a separate lightweight local ingest route, not the cloud route.
- Cloud pump commands currently enqueue `plugin_manual`, but the Node-RED flow has no command polling/input path for that. So cloud buttons/Alexa/MCP can enqueue commands, but Node-RED never receives them.

## Plan

1. **Fix token access in the Pi UI**
   - Add a safe “Node-RED Setup” panel in `/_authenticated/integrations` that shows:
     - Cloud event URL
     - Strategy URL
     - Command poll URL
     - Local fallback ingest URL
     - Cloud device token with a reveal/copy control after local Pi auth
   - Do not rely on the Node-RED copy button; provide ready-to-copy values and a ready-to-import flow from the Pi UI.
   - Make the token display explicitly say: use the Cloud Device Token, not the factory/reset/revocation token.

2. **Make local auth clear and practical**
   - Document and surface that:
     - The Pi web UI uses local PIN auth and sends `X-Pi-Auth` only for dashboard server calls.
     - Node-RED cloud calls use `Authorization: Bearer <CLOUD_DEVICE_TOKEN>`.
     - Local Node-RED fallback uses a local-only ingest token if configured, or LAN-only mode if no token is set.
   - Add a lightweight local ingest endpoint for Node-RED fallback so local dashboard data can be accepted into RAM without SD writes.

3. **Replace the downloadable Node-RED flow with a working full flow**
   - Update `public/nodered-template.json` so HTTP request nodes use dynamic `msg.url`, `msg.method`, and `msg.headers` only.
   - Remove Node-RED UI “Bearer Authentication” from the HTTP nodes to avoid masked/un-copyable auth fields.
   - Validate token presence in function nodes before sending; if empty, emit a clear debug error instead of spamming 401s.
   - Fix the disabled `Cloud-Bridge` tab and remove hardcoded stale tokens.
   - Include a “Test Cloud Push” inject node that posts a known event and makes 200/401 diagnosis obvious.

4. **Connect cloud commands to Node-RED**
   - Add a cloud command polling endpoint for Node-RED using the same device bearer token.
   - Add a Node-RED command poll subflow:
     - `GET /api/public/agent/poll`
     - if command is `plugin_manual` or `mqtt_publish`, map it to your Tasmota topic `cmnd/zisterne/POWER`.
     - POST result to `/api/public/agent/result`.
   - Update the cloud pump UI to send a Node-RED-friendly command payload for the pump (`id: pump`, action `on/off`, minutes).
   - Keep safety local: Node-RED still owns hard-failsafe, dry-run, overload, and runtime limits.

5. **Fix cloud analytics event naming**
   - Align emitted event components with the UI/MCP expectations:
     - `pump_control` and `pump_guard` for pump state/control
     - `eco_intelligence` for strategy decisions
     - `tibber_pulse` for live consumption
     - `weather_dwd` for weather
   - Adjust the Pump Control page to read those components instead of only `component=pump`, so events actually appear.

6. **Add storage for weather, Tibber, and pump usage without Pi SD writes**
   - Store time-series in Lovable Cloud via `device_events`; no local disk writes on the Pi.
   - Update the flow to push low-rate analytics events:
     - Tibber live wattage: throttled/downsampled
     - Weather: every 10 minutes
     - Pump telemetry: on change and periodic snapshot
   - Use the existing hourly aggregation job to build charts and AI reasoning inputs.
   - Extend docs with the exact payload examples and throttle recommendations for Pi 3.

7. **Verify**
   - Use server logs to confirm 401s stop after the flow uses a real token.
   - Test public API behavior with missing token, wrong token, and structurally valid request.
   - Verify the downloadable JSON has no hardcoded token, no fixed HTTP-node URL that blocks `msg.url`, and includes command poll/result nodes.
   - Verify cloud pump command path: UI/Alexa/MCP → `agent_commands` → Node-RED poll → MQTT command → result back to cloud.

## Technical notes

```text
Node-RED -> Cloud analytics
POST https://pi-hub.benniwie.com/api/public/cloud-bridge/event
Authorization: Bearer <CLOUD_DEVICE_TOKEN>

Node-RED -> Cloud strategy
GET https://pi-hub.benniwie.com/api/public/cloud-bridge/strategy
Authorization: Bearer <CLOUD_DEVICE_TOKEN>

Node-RED -> Cloud commands
GET https://pi-hub.benniwie.com/api/public/agent/poll
Authorization: Bearer <CLOUD_DEVICE_TOKEN>

Node-RED -> Command result
POST https://pi-hub.benniwie.com/api/public/agent/result
Authorization: Bearer <CLOUD_DEVICE_TOKEN>
```

The key rework is: Node-RED should use one Cloud Device Token everywhere for cloud communication, and command polling must be part of the flow so cloud buttons/Alexa/MCP can actually reach your Tasmota pump.