// Server-Sent-Events stream for the Pi dashboard. Pushes locally ingested
// ticks / events / traces to open tabs with no polling and no database.
// Auth: `?t=<pi token>` (EventSource cannot set headers). On a non-Pi preview
// build the check is relaxed, exactly like requirePiAuth.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/live-stream")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const token = url.searchParams.get("t");

        const { verifyPiToken } = await import("@/lib/pi-auth.server");
        const { hasProcStats } = await import("@/lib/pi-runtime.server");
        const isDev = process.env.NODE_ENV === "development";
        if (hasProcStats() && !isDev && !verifyPiToken(token)) {
          return new Response("Unauthorized", { status: 401 });
        }

        const { subscribeLocalBus } = await import("@/lib/local-live-bus.server");
        const encoder = new TextEncoder();

        let unsubscribe: (() => void) | undefined;
        let heartbeat: ReturnType<typeof setInterval> | undefined;

        const stream = new ReadableStream({
          start(controller) {
            const send = (event: string, data: unknown) => {
              try {
                controller.enqueue(
                  encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
                );
              } catch {
                /* client gone */
              }
            };
            send("hello", { ts: new Date().toISOString() });
            unsubscribe = subscribeLocalBus((e, payload) => send(e, payload));
            heartbeat = setInterval(() => send("ping", { ts: Date.now() }), 25_000);
          },
          cancel() {
            unsubscribe?.();
            if (heartbeat) clearInterval(heartbeat);
          },
        });

        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
            "X-Accel-Buffering": "no",
          },
        });
      },
    },
  },
});
