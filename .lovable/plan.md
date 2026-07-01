## Root cause

`public.agent_commands.kind` has a CHECK constraint that only allows
`status | container_action | mqtt_publish | mqtt_subscribe`.

Every code path that drives pump/plugins/terminal/reboot enqueues other
kinds (`plugin_manual`, `plugin_run_planner`, `plugin_create/update/delete`,
`plugin_get/list`, `terminal`, `system_reboot`). Postgres rejects the insert
with `agent_commands_kind_check`, the UI shows "Befehl abgelehnt", and
Node-RED's `?runner=nodered` poll never sees a command → pump stays off.

The Node-RED flow you pasted is fine — it handles `plugin_manual` correctly
and even maps the auto-off / eco-pause / reset logic. Nothing to change
there.

## Fix

### 1. Widen the CHECK constraint (single migration)

Drop and recreate `agent_commands_kind_check` to include every kind the app
actually enqueues:

```
status, container_action, mqtt_publish, mqtt_subscribe,
terminal, system_reboot,
plugin_list, plugin_get, plugin_create, plugin_update, plugin_delete,
plugin_run_planner, plugin_manual, plugin_eco_pause
```

`plugin_eco_pause` is included so the "Eco pausieren" button the Node-RED
flow already listens for can be wired next without another migration.

### 2. Verify write path after migration

- Re-run the Pump ON/OFF button from `/pump`; expect a row in
  `agent_commands` with `kind='plugin_manual'`, `payload.runner='nodered'`,
  `status='pending'`.
- The `/api/public/agent/poll?runner=nodered` handler already filters by
  `payload.runner === 'nodered'` and marks the row `delivered` — no code
  change needed.
- Node-RED's existing `Execute Pump/MQTT Command` function will emit
  `cmnd/zisterne/POWER ON` + auto-off after `minutes`, and POST the result
  back → row flips to `completed` → UI toast "Pumpe an".

### 3. Small UX follow-up in `src/routes/_cloud/pump.tsx`

The `manualMut.onError` toast currently prints the raw Postgres message.
Surface a clearer hint when the error text contains
`agent_commands_kind_check` (defensive, in case constraint drifts again):
"Server lehnt diesen Befehlstyp ab — bitte Support / Migration prüfen."
Purely cosmetic; safe to skip if you want the minimum change.

## Out of scope

- No changes to Node-RED template (`public/nodered-template.json`) — the
  user's deployed flow already matches what the cloud emits.
- No changes to Telegram / Alexa / MCP — they all funnel through the same
  `plugin_manual` enqueue, so they start working the moment the constraint
  is fixed.
- No changes to RLS / grants.

## Files

- **Migration** (`supabase--migration`): drop + recreate
  `agent_commands_kind_check` with the widened list.
- `src/routes/_cloud/pump.tsx`: friendlier error toast for constraint
  violations (optional, ~5 lines).
