## Problem

When the Pi opens the cloud popup to bridge, the user signs in successfully but then lands on **`/cloud/pair-callback` → 404**, breaking the pairing handoff. The popup never reaches the page that mints the device token, so the Pi-side poller times out and the bridge never activates.

## Root cause

The cloud routes live under the pathless layout `src/routes/_cloud.tsx`. Their actual URLs are:

```
/devices   /telegram   /audit   /mcp   /pair-callback
```

…**not** `/cloud/devices`, `/cloud/pair-callback`, etc. But several spots hardcode the `/cloud/*` prefix:

- `src/routes/auth.tsx` → `buildPostAuthTarget()` returns `"/cloud/pair-callback?..."` and `"/cloud/devices"` (both 404).
- `src/routes/_cloud.tsx` bottom-nav `tabs` array contains duplicated `/cloud/devices`, `/cloud/mcp`, `/cloud/telegram`, `/cloud/audit` entries (also 404 on click).

Secondary issue along the same path: the Google button in `auth.tsx` passes `redirect_uri: window.location.origin + postAuth`, i.e. it asks Google to come back directly into a protected `_cloud` route. Per the Supabase/Lovable OAuth guidance the `redirect_uri` must be a **public same-origin URL**; the protected layout's client-only session check then races the OAuth callback and can bounce to `/auth` or 404 before the session is hydrated. The destination must be `/auth` (public) and the auth page navigates onward once the session is live — which is exactly what the email/password branch already does.

## Fix

1. **`src/routes/auth.tsx` — `buildPostAuthTarget`**
   - Return `"/pair-callback?local=…&nonce=…&hostname=…"` (no `/cloud` prefix).
   - Default fallback returns `"/devices"`.
   - For the Google button, pass `redirect_uri: window.location.origin + "/auth?" + currentSearchParams` so Google returns to the public auth route; after `signInWithOAuth` resolves (or on the post-OAuth mount once the session lands), the existing `navigate({ to: postAuth })` carries the user to `/pair-callback` with the popup's `nonce`/`local`/`hostname` preserved.

2. **`src/routes/_cloud.tsx` — `tabs` array**
   - Remove the four duplicate `/cloud/*` entries. Keep only `/devices`, `/telegram`, `/audit`, plus add `/mcp` so the bottom nav matches the real routes.

3. **No backend / no schema / no pairing-logic changes.** `cloud-pairing.functions.ts`, `pair-callback.tsx`, and `/api/public/cloud-bridge/claim` are correct — they just never got reached.

## Verification

- From the Pi UI's Settings → "In Cloud anmelden & Bridge aktivieren":
  - Popup opens at `https://pi-hub.benniwie.com/auth?returnTo=pair-callback&local=…&nonce=…&hostname=…`.
  - After Google or email sign-in the popup navigates to `/pair-callback?...` (200, not 404) and shows "✓ <hostname> verknüpft".
  - Pi-side poll picks up the token within ~2.5 s and `host.cloudBridge.connected` flips to `true`.
- Bottom-nav tabs in the cloud UI all resolve (no 404).
