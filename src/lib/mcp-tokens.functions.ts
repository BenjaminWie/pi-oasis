// CRUD for MCP tokens (per-user, per-device API tokens for ChatGPT / Gemini /
// Alexa / Claude). Tokens are returned in plaintext exactly once on create,
// then only prefix + last-used are visible. All operations require the
// authenticated user.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { createHash, randomBytes } from "node:crypto";

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

const SCOPES = ["read", "control"] as const;

export const listMcpTokens = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("mcp_tokens")
      .select("id, name, device_id, token_prefix, scopes, expires_at, last_used_at, created_at")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const createMcpToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      deviceId: z.string().uuid(),
      name: z.string().min(1).max(64),
      scopes: z.array(z.enum(SCOPES)).min(1).max(2),
      expiresInDays: z.number().int().min(1).max(3650).optional(),
    }).parse,
  )
  .handler(async ({ data, context }) => {
    // Verify the device belongs to this user (RLS enforces too, but be explicit).
    const { data: dev, error: dErr } = await context.supabase
      .from("devices")
      .select("id")
      .eq("id", data.deviceId)
      .maybeSingle();
    if (dErr) throw new Error(dErr.message);
    if (!dev) throw new Error("Gerät nicht gefunden");

    const raw = "mcp_" + randomBytes(32).toString("base64url");
    const prefix = raw.slice(0, 12);
    const hash = sha256(raw);
    const expiresAt = data.expiresInDays
      ? new Date(Date.now() + data.expiresInDays * 24 * 3600 * 1000).toISOString()
      : null;

    const { data: row, error } = await context.supabase
      .from("mcp_tokens")
      .insert({
        user_id: context.userId,
        device_id: data.deviceId,
        name: data.name,
        token_prefix: prefix,
        token_hash: hash,
        scopes: data.scopes,
        expires_at: expiresAt,
      })
      .select("id, name, token_prefix, scopes, expires_at, created_at")
      .single();
    if (error) throw new Error(error.message);

    return { ...row, token: raw };
  });

export const deleteMcpToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ id: z.string().uuid() }).parse)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("mcp_tokens").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listMcpAudit = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("mcp_audit")
      .select("id, tool, status, latency_ms, error, device_id, created_at")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return data ?? [];
  });
