// Pi-side endpoint that receives the freshly-minted cloud device token from
// the user's browser after they sign into the cloud. CORS-enabled because
// the request is cross-origin (cloud → http://raspberrypi.local:3000).
// Authenticated via the single-use HMAC nonce that the same Pi issued
// moments earlier via `createPairingNonce`.
import { createFileRoute } from "@tanstack/react-router";

const ALLOW_HEADERS = "content-type";

function cors(origin: string | null): HeadersInit {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": ALLOW_HEADERS,
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}

function json(body: any, status = 200, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

export const Route = createFileRoute("/api/public/cloud-bridge/install")({
  server: {
    handlers: {
      OPTIONS: ({ request }) =>
        new Response(null, { status: 204, headers: cors(request.headers.get("origin")) }),
      POST: async ({ request }) => {
        const origin = request.headers.get("origin");
        const head = cors(origin);
        const { hasProcStats } = await import("@/lib/pi-runtime.server");
        if (!hasProcStats()) return json({ error: "not a Pi runtime" }, 400, head);

        let body: any;
        try {
          body = await request.json();
        } catch {
          return json({ error: "invalid json" }, 400, head);
        }
        const { nonce, cloudUrl, deviceId, deviceToken, name } = body || {};
        if (!nonce || !cloudUrl || !deviceId || !deviceToken || !name) {
          return json({ error: "missing fields" }, 400, head);
        }

        const { verifyPiToken } = await import("@/lib/pi-auth.server");
        if (!verifyPiToken(nonce) || !nonce.startsWith("cloud-pair.")) {
          return json({ error: "invalid or expired nonce" }, 401, head);
        }

        const { setCloudConfig } = await import("@/lib/pin-store.server");
        await setCloudConfig({
          cloudUrl: String(cloudUrl).replace(/\/+$/, ""),
          deviceId: String(deviceId),
          deviceToken: String(deviceToken),
          name: String(name),
          installedAt: new Date().toISOString(),
        });

        const { ensureCloudBridgeStarted } = await import("@/lib/cloud-bridge.server");
        ensureCloudBridgeStarted();

        return json({ ok: true, name }, 200, head);
      },
    },
  },
});
