// Shared OAuth scope normalisation for Alexa account linking.
//
// Alexa often sends no scope at all. Every voice intent begins with a read
// tool (list_plugins / get_status), so a token minted with only "control"
// fails with "missing scope read" before any tool executes. Therefore:
// - empty scope  → "read control"
// - any scope containing "control" implicitly gains "read"

const VALID = ["read", "control"] as const;

export function normalizeScopes(input?: string | string[] | null): string[] {
  const raw = Array.isArray(input) ? input : String(input ?? "").split(/[\s,]+/);
  const set = new Set(raw.map((s) => s.trim().toLowerCase()).filter(Boolean));
  if (set.size === 0) {
    set.add("read");
    set.add("control");
  }
  if (set.has("control")) set.add("read");
  return VALID.filter((s) => set.has(s));
}

export function normalizeScope(input?: string | string[] | null): string {
  return normalizeScopes(input).join(" ");
}
