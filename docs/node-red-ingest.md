# Node-RED → pi-hub ingest

`pi-hub` exposes a **loopback-only** HTTP endpoint that accepts structured
device events from Node-RED (or any local process) running on the same Pi,
buffers them in RAM, and forwards each event to the Lovable Cloud through
the existing device bridge. **Nothing is written to the SD card.**

## Endpoint

```
POST http://127.0.0.1:3000/api/public/ingest/event
Authorization: Bearer <PI_INGEST_TOKEN>
Content-Type: application/json
```

Refuses any request that does not come from `127.0.0.1` / `::1`.

## Payload

Strict schema. Unknown fields are rejected.

```json
{
  "component": "pump_monitor",
  "device": "zisterne_drainpress",
  "timestamp": "2026-06-25T20:32:00.000Z",
  "status": "healthy",
  "metrics": { "watt": 395, "voltage": 231, "today_kwh": 0.45 }
}
```

| field       | type                                                |
|-------------|-----------------------------------------------------|
| `component` | string, 1–64 chars                                  |
| `device`    | string, 1–64 chars                                  |
| `timestamp` | ISO 8601 with offset (optional, defaults to `now`)  |
| `status`    | `healthy` \| `warning` \| `critical` \| `info`      |
| `metrics`   | object, values must be number / string / boolean    |

## Node-RED setup

1. In Node-RED, add an **HTTP Request** node at the end of the flow that emits
   the JSON above as `msg.payload`.
2. Configure it:
   - Method: `POST`
   - URL: `http://127.0.0.1:3000/api/public/ingest/event`
   - Return: `a parsed JSON object`
   - Use authentication: **off** (we add the header explicitly below)
3. Drop a **Change** node *before* the HTTP Request that sets:
   - `msg.headers` → `{ "Authorization": "Bearer " & $env('PI_INGEST_TOKEN'), "Content-Type": "application/json" }`

   The token comes from `PI_INGEST_TOKEN` in `pi-hub`'s `.env`. Inject it
   into Node-RED's environment via systemd (`Environment=PI_INGEST_TOKEN=…`)
   or `~/.node-red/environment` — **never hardcode** it into the flow JSON
   (the export ends up on disk and in backups).
4. Deploy.

Every Node-RED event now appears live in **pi-hub → Events** and is forwarded
to the cloud where you (or the Telegram bot) can read it from anywhere.

## Zero SD-card writes

- The ingest route appends to a 200-entry RAM ring buffer.
- The cloud forwarder retries up to 50 events in RAM; on overflow it drops
  oldest and bumps a counter shown in the UI.
- For extra paranoia, mount `/var/log/pi-hub` as `tmpfs` so any accidental
  logs also stay in RAM:

  ```
  echo 'tmpfs /var/log/pi-hub tmpfs defaults,noatime,size=16M 0 0' | sudo tee -a /etc/fstab
  sudo mkdir -p /var/log/pi-hub && sudo mount /var/log/pi-hub
  ```

## Quick test

```sh
curl -sS -X POST http://127.0.0.1:3000/api/public/ingest/event \
  -H "Authorization: Bearer $PI_INGEST_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"component":"pump_monitor","device":"zisterne_drainpress","status":"healthy","metrics":{"watt":395,"voltage":231,"today_kwh":0.45}}'
```

Expected: `{"ok":true,"id":1}` and the event shows up in `/events` within 2s.

From a different host on the LAN you should get `403 loopback only`. With a
wrong token: `401 unauthorized`. That is by design.
