// Stateless, HMAC-signed tokens — the database-free replacement for the
// `mcp_tokens` / `alexa_oauth_codes` tables.
//
// Format: <base64url(JSON payload)>.<base64url(HMAC-SHA256)>
// Secret:  PIHUB_TOKEN_SECRET (falls back to PIHUB_DEVICE_TOKEN so an existing
//          install keeps working without adding a second secret).
//
// Because nothing is stored, revocation happens by rotating the secret.

import { createHmac, timingSafeEqual } from "node:crypto";

export type TokenKind = "access" | "refresh" | "code" | "session";

export interface TokenPayload {
  k: TokenKind;
  /** subject — the account identifier; a single-Pi install uses "owner" */
  sub: string;
  /** granted scopes */
  sc?: string[];
  /** issued at (seconds) */
  iat: number;
  /** expires at (seconds) */
  exp: number;
  /** free-form extras (client_id, redirect_uri, …) */
  [k: string]: unknown;
}

function secret(): string {
  const s = process.env.PIHUB_TOKEN_SECRET || process.env.PIHUB_DEVICE_TOKEN;
  if (!s) throw new Error("PIHUB_TOKEN_SECRET not configured");
  return s;
}

function b64u(buf: Buffer | string): string {
  return Buffer.from(buf).toString("base64url");
}

function sign(data: string): string {
  return createHmac("sha256", secret()).update(data).digest("base64url");
}

export function issueToken(
  kind: TokenKind,
  ttlSec: number,
  extra: Record<string, unknown> = {},
  sub = "owner",
): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: TokenPayload = { k: kind, sub, iat: now, exp: now + ttlSec, ...extra };
  const body = b64u(JSON.stringify(payload));
  return `${body}.${sign(body)}`;
}

export function verifyToken(
  token: string | null | undefined,
  kind?: TokenKind,
): TokenPayload | null {
  if (!token || typeof token !== "string") return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  let expected: string;
  try {
    expected = sign(body);
  } catch {
    return null;
  }
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  let payload: TokenPayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf-8"));
  } catch {
    return null;
  }
  if (kind && payload.k !== kind) return null;
  if (!payload.exp || payload.exp * 1000 < Date.now()) return null;
  return payload;
}

/** The single OAuth client of this install (Alexa account linking). */
export function oauthClient() {
  const id = process.env.PIHUB_OAUTH_CLIENT_ID || "";
  const secretValue = process.env.PIHUB_OAUTH_CLIENT_SECRET || "";
  return { id, secret: secretValue, configured: Boolean(id && secretValue) };
}
