import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requirePiAuth } from "./pi-auth-middleware";
import { z } from "zod";

// === Pi-local: mint a single-use HMAC nonce ===============================
// Issued by the local Pi dashboard, travels through the popup URL into the
// cloud, and is presented back to the Pi via `claimCloudPairing` to prove
// the freshly-minted device token really belongs to this same Pi session.

export const createPairingNonce = createServerFn({ method: "POST" })
  .middleware([requirePiAuth])
  .handler(async () => {
    const { hasProcStats } = await import("./pi-runtime.server");
    if (!hasProcStats()) {
      return { ok: false as const, error: "Pairing only available on the Pi runtime" };
    }
    const { signPiToken } = await import("./pi-auth.server");
    const nonce = signPiToken("cloud-pair", 600); // 10 min
    return { ok: true as const, nonce };
  });

// === Cloud: store a one-shot pairing for the Pi to pick up ================
// Runs after Supabase sign-in on the cloud popup. Creates a device row and
// writes the (token, deviceId) pair into `cloud_pairings` keyed by sha256(nonce).

export const mintLocalPairing = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    z.object({
      nonce: z.string().min(8).max(512),
      hostname: z.string().min(1).max(128),
    }).parse,
  )
  .handler(async ({ data, context }) => {
    const { randomBytes, createHash } = await import("node:crypto");
    const token = randomBytes(32).toString("base64url");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const nonceHash = createHash("sha256").update(data.nonce).digest("hex");

    const { data: device, error: devErr } = await context.supabase
      .from("devices")
      .insert({
        user_id: context.userId,
        name: data.hostname,
        device_token_hash: tokenHash,
      })
      .select("id, name")
      .single();
    if (devErr) throw new Error(devErr.message);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error: pairErr } = await supabaseAdmin.from("cloud_pairings").insert({
      nonce_hash: nonceHash,
      user_id: context.userId,
      device_id: device.id,
      device_token: token,
      device_name: device.name,
    });
    if (pairErr) {
      // best-effort cleanup of orphan device row
      await context.supabase.from("devices").delete().eq("id", device.id);
      throw new Error(pairErr.message);
    }
    return { ok: true as const, name: device.name };
  });

// === Pi-local: poll the cloud for the pairing we just minted ==============

export const claimCloudPairing = createServerFn({ method: "POST" })
  .middleware([requirePiAuth])
  .validator((d: { nonce: string; cloudUrl?: string }) => {
    if (typeof d.nonce !== "string" || d.nonce.length < 8) throw new Error("invalid nonce");
    return d;
  })
  .handler(async ({ data }) => {
    const { hasProcStats } = await import("./pi-runtime.server");
    if (!hasProcStats()) return { ok: false as const, error: "not on Pi" };
    const cloudUrl = (data.cloudUrl || "https://pi-hub.benniwie.com").replace(/\/+$/, "");
    try {
      const res = await fetch(cloudUrl + "/api/public/cloud-bridge/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nonce: data.nonce }),
      });
      if (res.status === 404) return { ok: false as const, pending: true as const };
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        return { ok: false as const, error: `cloud ${res.status}: ${txt.slice(0, 200)}` };
      }
      const j = (await res.json()) as {
        deviceId: string;
        deviceToken: string;
        name: string;
      };
      const { setCloudConfig } = await import("./pin-store.server");
      await setCloudConfig({
        cloudUrl,
        deviceId: j.deviceId,
        deviceToken: j.deviceToken,
        name: j.name,
        installedAt: new Date().toISOString(),
      });
      const { ensureCloudBridgeStarted } = await import("./cloud-bridge.server");
      ensureCloudBridgeStarted();
      return { ok: true as const, name: j.name };
    } catch (e: any) {
      return { ok: false as const, error: e?.message || String(e) };
    }
  });

export const disconnectCloudBridge = createServerFn({ method: "POST" })
  .middleware([requirePiAuth])
  .handler(async () => {
    const { hasProcStats } = await import("./pi-runtime.server");
    if (!hasProcStats()) return { ok: false as const };
    const { setCloudConfig } = await import("./pin-store.server");
    await setCloudConfig(null);
    return { ok: true as const };
  });
