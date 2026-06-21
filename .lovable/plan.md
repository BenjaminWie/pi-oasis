## Enable Google Sign-In

Add Google as a managed OAuth provider for the Cloud Management UI auth flow at `/auth`.

### Changes

1. **Enable Google provider** in Lovable Cloud auth (managed OAuth — no manual client ID / secret needed).
2. **Update `src/routes/auth.tsx`**: add a "Continue with Google" button above the existing email/password form, calling `lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.origin + "/cloud/devices" })`. Handle `result.error` (toast) and `result.redirected` (return). Keep email/password as fallback.
3. The existing `handle_new_user` trigger already creates a `profiles` row on first sign-in, so Google users get a profile automatically — no schema change.

### Out of scope
- BYO Google credentials (managed broker is used).
- Disabling email/password (kept as alternative).
