// Server functions for Alexa OAuth client management.
// - listAlexaClients: current household's clients (id + partial secret only)
// - createAlexaClient: mints a new client_id + client_secret (secret shown ONCE)
// - deleteAlexaClient: revokes a client (auth linkings using it stop refreshing)

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const listAlexaClients = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("alexa_oauth_clients")
      .select("id, client_id, name, device_id, created_at, last_used_at")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const createAlexaClient = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { device_id?: string; name?: string }) =>
    z.object({
      device_id: z.string().uuid().optional(),
      name: z.string().min(1).max(120).default("Alexa Skill"),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { randomBytes, createHash } = await import("crypto");
    const client_id = "pihub_" + randomBytes(12).toString("base64url");
    const client_secret = randomBytes(32).toString("base64url");
    const client_secret_hash = createHash("sha256").update(client_secret).digest("hex");

    let device_id = data.device_id;
    if (!device_id) {
      const { data: dev } = await context.supabase
        .from("devices")
        .select("id")
        .order("last_seen_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      device_id = (dev as any)?.id;
    }
    if (!device_id) throw new Error("Kein gepairter Pi gefunden. Bitte zuerst einen Pi verbinden.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("alexa_oauth_clients").insert({
      user_id: context.userId,
      device_id,
      client_id,
      client_secret_hash,
      name: data.name,
    });
    if (error) throw new Error(error.message);
    return { client_id, client_secret };
  });

export const deleteAlexaClient = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("alexa_oauth_clients")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// Match if entry is an exact match, or if entry ends with '/' and the incoming
// URI starts with it (so default prefixes like 'https://layla.amazon.com/api/skill/link/'
// cover any vendor-ID suffix Alexa appends).
export function isRedirectUriAllowed(allowed: string[], received: string): boolean {
  for (const a of allowed) {
    if (a === received) return true;
    if (a.endsWith("/") && received.startsWith(a)) return true;
  }
  return false;
}

export const getAlexaConsent = createServerFn({ method: "POST" })
  .inputValidator((d: {
    client_id: string;
    redirect_uri: string;
    scope?: string;
    response_type?: string;
  }) =>
    z.object({
      client_id: z.string().min(1),
      redirect_uri: z.string().min(1),
      scope: z.string().default("control"),
      response_type: z.string().default("code"),
    }).parse(d),
  )
  .handler(async ({ data }) => {
    if (data.response_type !== "code") throw new Error("unsupported response_type");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: client } = await supabaseAdmin
      .from("alexa_oauth_clients")
      .select("id, name, user_id, device_id, redirect_uris")
      .eq("client_id", data.client_id)
      .maybeSingle();
    if (!client) {
      console.warn("[alexa-oauth] unknown client_id", { client_id: data.client_id });
      throw new Error("unknown client_id");
    }
    const allowed = (client.redirect_uris as string[]) ?? [];
    if (!isRedirectUriAllowed(allowed, data.redirect_uri)) {
      console.warn("[alexa-oauth] redirect_uri mismatch", {
        client_id: data.client_id,
        received: data.redirect_uri,
        allowed,
      });
      const err = new Error(
        `redirect_uri not in allowlist for this client.\nempfangen: ${data.redirect_uri}\nerlaubt: ${allowed.join(", ") || "(leer)"}`,
      );
      (err as any).code = "redirect_uri_mismatch";
      (err as any).received = data.redirect_uri;
      (err as any).allowed = allowed;
      (err as any).clientId = data.client_id;
      throw err;
    }
    const { data: device } = await supabaseAdmin
      .from("devices")
      .select("name")
      .eq("id", client.device_id!)
      .maybeSingle();
    console.info("[alexa-oauth] consent shown", { client_id: data.client_id });
    return {
      clientName: (client as any).name || "Alexa Skill",
      clientId: data.client_id,
      redirectUri: data.redirect_uri,
      scope: data.scope,
      state: "",
      userEmail: null as string | null,
      deviceName: (device as any)?.name ?? null as string | null,
    };
  });

export const updateAlexaClientRedirectUris = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; redirect_uris: string[] }) =>
    z.object({
      id: z.string().uuid(),
      redirect_uris: z.array(z.string().url()).max(20),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    // RLS: user must own the row (user_id = auth.uid()).
    const { error } = await context.supabase
      .from("alexa_oauth_clients")
      .update({ redirect_uris: data.redirect_uris })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
