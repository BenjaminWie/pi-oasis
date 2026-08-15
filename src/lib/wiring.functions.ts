// Wiring status for the database-free cloud relay.
//
// Everything here is derived from env config + a live probe of the Pi through
// the relay. No Supabase tables are touched, so these pages keep working while
// the hosted database is paused.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export interface WiringStatus {
  baseUrl: string;
  relay: { configured: boolean; piUrl: string | null; online: boolean; stale: boolean; ageSec: number | null; error?: string };
  telegram: { configured: boolean; secretSet: boolean; chatAllowlist: number; webhookUrl: string; botUsername: string | null; webhookOk: boolean | null; webhookInfo: string | null };
  alexa: { clientConfigured: boolean; linkSecretSet: boolean; tokenSecretSet: boolean; authorizeUrl: string; tokenUrl: string; skillEndpoint: string; extraRedirectUris: string[] };
  ai: { gatewayKeySet: boolean };
}

function baseUrl(): string {
  return (process.env.PIHUB_PUBLIC_URL || "https://pi-hub.benniwie.com").replace(/\/+$/, "");
}

export const getWiringStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<WiringStatus> => {
    const { piConfig, getPiState } = await import("@/lib/pi-relay.server");
    const { oauthClient } = await import("@/lib/stateless-token.server");

    const pi = piConfig();
    const probe = pi.configured
      ? await getPiState()
      : { ok: false, stale: false, ageSec: null as number | null, error: "pi_not_configured" };

    const base = baseUrl();
    const botToken = process.env.PIHUB_TELEGRAM_BOT_TOKEN || "";
    let botUsername: string | null = null;
    let webhookOk: boolean | null = null;
    let webhookInfo: string | null = null;
    if (botToken) {
      try {
        const me = await fetch(`https://api.telegram.org/bot${botToken}/getMe`).then((r) => r.json());
        botUsername = me?.result?.username ?? null;
        const wh = await fetch(`https://api.telegram.org/bot${botToken}/getWebhookInfo`).then((r) =>
          r.json(),
        );
        const url: string = wh?.result?.url ?? "";
        webhookOk = url === `${base}/api/public/telegram/webhook`;
        webhookInfo = wh?.result?.last_error_message || url || null;
      } catch {
        botUsername = null;
      }
    }

    const client = oauthClient();

    return {
      baseUrl: base,
      relay: {
        configured: pi.configured,
        piUrl: pi.url || null,
        online: Boolean(probe.ok && !probe.stale),
        stale: Boolean(probe.stale),
        ageSec: probe.ageSec ?? null,
        error: (probe as { error?: string }).error,
      },
      telegram: {
        configured: Boolean(botToken),
        secretSet: Boolean(process.env.PIHUB_TELEGRAM_WEBHOOK_SECRET),
        chatAllowlist: (process.env.PIHUB_TELEGRAM_CHAT_IDS || "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean).length,
        webhookUrl: `${base}/api/public/telegram/webhook`,
        botUsername,
        webhookOk,
        webhookInfo,
      },
      alexa: {
        clientConfigured: client.configured,
        linkSecretSet: Boolean(process.env.PIHUB_LINK_SECRET || process.env.PIHUB_DEVICE_TOKEN),
        tokenSecretSet: Boolean(process.env.PIHUB_TOKEN_SECRET || process.env.PIHUB_DEVICE_TOKEN),
        authorizeUrl: `${base}/api/public/oauth/authorize`,
        tokenUrl: `${base}/api/public/oauth/token`,
        skillEndpoint: `${base}/api/public/voice/alexa`,
        extraRedirectUris: (process.env.PIHUB_OAUTH_REDIRECT_URIS || "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      },
      ai: { gatewayKeySet: Boolean(process.env.LOVABLE_API_KEY) },
    };
  });

/** Point the configured Telegram bot at this deployment's webhook. */
export const installTelegramWebhook = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const botToken = process.env.PIHUB_TELEGRAM_BOT_TOKEN;
    if (!botToken) throw new Error("PIHUB_TELEGRAM_BOT_TOKEN ist nicht gesetzt.");
    const secret = process.env.PIHUB_TELEGRAM_WEBHOOK_SECRET || "";
    const url = `${baseUrl()}/api/public/telegram/webhook`;
    const res = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url,
        ...(secret ? { secret_token: secret } : {}),
        allowed_updates: ["message"],
        drop_pending_updates: true,
      }),
    });
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string };
    if (!body.ok) throw new Error(body.description || "setWebhook fehlgeschlagen");
    return { ok: true, url };
  });
