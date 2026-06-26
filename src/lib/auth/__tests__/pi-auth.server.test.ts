import { describe, it, expect, vi, beforeEach } from "vitest";
import { signPiToken, verifyPiToken } from "../pi-auth.server";

describe("pi-auth.server", () => {
  it("should sign and verify a token", () => {
    const token = signPiToken("test-device", 3600);
    expect(token).toBeDefined();
    expect(verifyPiToken(token)).toBe(true);
  });

  it("should fail for an invalid token", () => {
    expect(verifyPiToken("invalid.token")).toBe(false);
    expect(verifyPiToken(null)).toBe(false);
  });

  it("should fail for an expired token", () => {
    const token = signPiToken("test-device", -10);
    expect(verifyPiToken(token)).toBe(false);
  });

  it("should fail for a tampered token", () => {
    const token = signPiToken("test-device", 3600);
    const parts = token.split(".");
    parts[0] = "malicious-sub";
    const tampered = parts.join(".");
    expect(verifyPiToken(tampered)).toBe(false);
  });
});
