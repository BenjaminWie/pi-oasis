// Download the generated de-DE Alexa interaction model.
// Gated by the Pi link secret so the endpoint catalogue is not public.
import { createFileRoute } from "@tanstack/react-router";
import { bearer, jsonResponse } from "@/lib/agent-api.server";

function linkSecret() {
  return process.env.PIHUB_LINK_SECRET || process.env.PIHUB_DEVICE_TOKEN || "";
}

export const Route = createFileRoute("/api/public/voice/alexa-model")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const secret = linkSecret();
        if (!secret) return jsonResponse({ error: "no_link_secret" }, 500);
        const url = new URL(request.url);
        const given = bearer(request) || url.searchParams.get("s") || "";
        if (given !== secret) return jsonResponse({ error: "unauthorized" }, 401);

        const { buildAlexaModel } = await import("@/lib/alexa-model.server");
        const model = await buildAlexaModel("alexa");
        return new Response(JSON.stringify(model, null, 2), {
          headers: {
            "content-type": "application/json; charset=utf-8",
            "content-disposition": 'attachment; filename="pi-control-alexa-de-DE.json"',
            "cache-control": "no-store",
          },
        });
      },
    },
  },
});
