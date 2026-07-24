## Problem

The Alexa consent screen crashes with `Missing Supabase environment variable(s): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY`.

Root cause (verified in `src/routes/api/public/oauth/authorize.tsx`): the route is `ssr: false`, so its `loader` runs in the **browser**. The loader dynamically imports `@/integrations/supabase/client.server` and calls `supabaseAdmin`. In the browser, `process.env.SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` are undefined, so `client.server.ts` throws immediately — which Alexa sees as "Verknüpfung fehlgeschlagen".

The service role client must never run in the browser regardless.

## Fix

1. Extract the consent lookup into a new server function `getAlexaConsent` (in `src/lib/alexa-oauth.functions.ts`), taking `{ client_id, redirect_uri, scope, response_type }` and returning the existing `LoaderData` shape. It uses `supabaseAdmin` inside the handler (already server-only).
2. Rewrite `src/routes/api/public/oauth/authorize.tsx`:
   - Keep `ssr: false` and the `beforeLoad` session check.
   - Replace the inline `loadConsent` with a call to `getAlexaConsent({ data: {...} })` from the loader.
   - Delete the direct `@/integrations/supabase/client.server` import from this file.
3. No DB / OAuth logic changes — POST handler, tables, and the Alexa console values already shown to the user stay identical.

## Verification

- `tsgo` typecheck.
- Reload `/api/public/oauth/authorize?...` while signed in: consent screen renders instead of the env-var error; approving still redirects to Alexa's `redirect_uri` with `?code=&state=`.
