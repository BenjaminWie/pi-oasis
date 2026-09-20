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
  alexa: { clientConfigured: boolean; linkSecretSet: boolean; tokenSecretSet: boolean; skillIdSet: boolean; authorizeUrl: string; tokenUrl: string; skillEndpoint: string; modelUrl: string; extraRedirectUris: string[] };
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
        skillIdSet: Boolean(process.env.PIHUB_ALEXA_SKILL_ID),
        authorizeUrl: `${base}/api/public/oauth/authorize`,
        tokenUrl: `${base}/api/public/oauth/token`,
        skillEndpoint: `${base}/api/public/voice/alexa`,
        modelUrl: `${base}/api/public/voice/alexa-model`,
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

export interface SelftestStep {
  name: string;
  ok: boolean;
  info: string;
}

/**
 * Walks the whole Alexa chain without Amazon: mints a token like the OAuth
 * routes do, then answers real intents through the endpoint catalogue.
 */
export const alexaSelftest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<{ steps: SelftestStep[] }> => {
    const { oauthClient, issueToken, verifyToken } = await import("@/lib/stateless-token.server");
    const { endpointList, pumpStatus, systemStatus } = await import("@/lib/voice-intents.server");
    const steps: SelftestStep[] = [];

    const client = oauthClient();
    steps.push({
      name: "OAuth-Client",
      ok: client.configured,
      info: client.configured ? "Client-ID und Secret gesetzt" : "PIHUB_OAUTH_CLIENT_ID/_SECRET fehlen",
    });
    steps.push({
      name: "Link-Geheimwort",
      ok: Boolean(process.env.PIHUB_LINK_SECRET || process.env.PIHUB_DEVICE_TOKEN),
      info: "wird auf der Zustimmungs-Seite abgefragt",
    });

    let tokenOk = false;
    try {
      const access = issueToken("access", 60, { sc: ["read", "control"] }, "selftest");
      tokenOk = Boolean(verifyToken(access, "access"));
    } catch (e) {
      tokenOk = false;
      steps.push({ name: "Token-Signatur", ok: false, info: String((e as Error)?.message ?? e) });
    }
    if (tokenOk) steps.push({ name: "Token-Signatur", ok: true, info: "Token signiert und geprüft" });

    const ctx = { source: "alexa" as const, userId: "selftest", allowControl: true };
    try {
      const list = await endpointList();
      steps.push({ name: "Endpunkt-Katalog", ok: list.ok, info: list.speech.slice(0, 160) });
    } catch (e) {
      steps.push({ name: "Endpunkt-Katalog", ok: false, info: String((e as Error)?.message ?? e) });
    }
    try {
      const st = await pumpStatus(ctx);
      steps.push({ name: "Pumpen-Status", ok: st.ok, info: st.speech.slice(0, 160) });
    } catch (e) {
      steps.push({ name: "Pumpen-Status", ok: false, info: String((e as Error)?.message ?? e) });
    }
    try {
      const sys = await systemStatus(ctx);
      steps.push({ name: "Gesamtstatus", ok: sys.ok, info: sys.speech.slice(0, 160) });
    } catch (e) {
      steps.push({ name: "Gesamtstatus", ok: false, info: String((e as Error)?.message ?? e) });
    }

    return { steps };
  });

/** The de-DE interaction model as pretty JSON, built from the live catalogue. */
export const getAlexaModelJson = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<{ json: string; endpoints: number }> => {
    const { buildAlexaModel } = await import("@/lib/alexa-model.server");
    const model = await buildAlexaModel("alexa");
    const values = model.interactionModel.languageModel.types[0]?.values?.length ?? 0;
    return { json: JSON.stringify(model, null, 2), endpoints: values };
  });
