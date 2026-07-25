## Problem

On the Alexa consent screen, clicking **Zustimmen** / **Ablehnen** shows:
`Unexpected token '<', "<!DOCTYPE "... is not valid JSON`.

Root cause: `src/routes/api/public/oauth/authorize.tsx` renders the consent UI (GET only). The POST handler that mints the auth code actually lives in a separate file at `src/routes/api/public/oauth/authorize-post.ts` (URL `/api/public/oauth/authorize-post`). The client fetch posts to `/api/public/oauth/authorize`, which has no POST handler, so TanStack falls back to the SPA HTML shell — the client tries to `JSON.parse("<!DOCTYPE …")` and blows up. This is unrelated to the Alexa redirect URI allowlist you just updated.

## Fix

Single change in `src/routes/api/public/oauth/authorize.tsx` (component `Consent`, function `approve`):

- Change the fetch URL from `/api/public/oauth/authorize` to `/api/public/oauth/authorize-post`.
- Keep method, headers (bearer), and body exactly as they are.

That is the whole fix — the server-side POST handler at `authorize-post.ts` is already correct (validates bearer → resolves user → checks `client_id` ownership → `isRedirectUriAllowed` → mints code or returns `access_denied` → returns `{ redirect }`).

## Verification

1. Sign in, open the Alexa "Link Account" flow again.
2. On the consent screen click **Zustimmen** → browser should 302 to the Alexa `redirect_uri` with `?code=...&state=...`, not show the JSON parse error.
3. Alexa should then hit `/api/public/oauth/token` and complete linking.
4. Also click **Ablehnen** once and confirm it redirects with `?error=access_denied`.

## Notes

- No DB migration, no allowlist change, no Alexa Skill config change needed.
- If the same JSON parse error re-appears later on `/oauth/token`, that's a separate handler — tell me and I'll trace it the same way.
