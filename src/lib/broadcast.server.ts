// Zero-Wake helper: publish a wake-up ping on the Supabase Realtime broadcast
// channel `commands:<device_id>` after enqueueing an agent_commands row.
//
// Node-RED (and the Pi bridge) subscribes to this channel over WebSocket and
// only then issues a single GET to /api/public/agent/poll — Postgres is not
// polled every 30 seconds.
//
// Fire-and-forget: if the broadcast HTTP call fails, the Node-RED safety-net
// poll (every 15 min) still delivers the command.

export async function broadcastCommandWake(deviceId: string): Promise<void> {
  const url = `${process.env.SUPABASE_URL}/realtime/v1/api/broadcast`;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return;
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
            payload: { ts: new Date().toISOString() },
            private: false,
          },
        ],
      }),
    });
  } catch {
    /* safety-net poll will pick it up */
  }
}
