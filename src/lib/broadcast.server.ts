// Zero-Wake helper: push commands to the Pi over the Supabase Realtime
// broadcast channel `commands:<device_id>`.
//
// The Pi bridge holds ONE WebSocket subscription and executes the command the
// moment it arrives — no HTTP polling, no Postgres wake-up, sub-second latency.
// The full command travels in the payload, so the Pi does not need to call
// /api/public/agent/poll to fetch it.
//
// Fire-and-forget: if the broadcast fails, the Pi's 15-minute safety-net poll
// (and its catch-up poll on reconnect) still delivers the command.

export interface WakeCommand {
  id: string;
  kind: string;
  payload?: unknown;
}

export async function broadcastCommandWake(
  deviceId: string,
  command?: WakeCommand,
): Promise<void> {
  const url = `${process.env.SUPABASE_URL}/realtime/v1/api/broadcast`;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return;

  // Keep the payload small — oversized broadcasts are dropped by Realtime.
  // If the command is too big, send a bare wake and let the Pi fetch it.
  let cmd: WakeCommand | undefined = command;
  if (cmd) {
    try {
      if (JSON.stringify(cmd).length > 6000) cmd = { id: cmd.id, kind: cmd.kind };
    } catch {
      cmd = { id: cmd.id, kind: cmd.kind };
    }
  }

  try {
    await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        messages: [
          {
            topic: `commands:${deviceId}`,
            event: "wake",
            payload: { ts: new Date().toISOString(), command: cmd ?? null },
            private: false,
          },
        ],
      }),
    });
  } catch {
    /* safety-net poll will pick it up */
  }
}
