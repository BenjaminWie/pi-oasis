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
