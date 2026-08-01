## What I found

Account linking itself worked — the logs show a successful `authorize` and `authorization_code` exchange at 22:17, and a valid Alexa token exists bound to your Pi (`raspi1`).

The failure is a scope problem:

- The minted Alexa token has scopes `["control"]` only.
- Every Alexa intent starts with a read tool: `list_plugins`, `get_status`, `get_plugin`, `get_tibber_price_now`, `infer_appliance_state` are all declared `scope: "read"`.
- The skill handler rejects the call before running it (`missing scope read`), which is why `mcp_audit` has zero rows — the tool never executed — and Alexa spoke a generic error.

Root cause: `/api/public/oauth/authorize-post` defaults the scope to `"control"` when Alexa sends no scope, and the token endpoint mints exactly that.

## The fix

1. **Default scope** — in `src/routes/api/public/oauth/authorize-post.ts`, default to `"read control"` instead of `"control"`, and normalize any incoming scope so `control` always implies `read`.
2. **Token minting** — in `src/routes/api/public/oauth/token.ts`, apply the same normalization for both `authorization_code` and `refresh_token` grants, so re-linking and refreshes can't drop `read`.
3. **Backfill** — one migration to add `read` to existing `source = 'alexa'` tokens so you don't have to unlink/relink.
4. **Better error speech** — in `src/routes/api/public/voice/alexa.ts`, write an audit row when a call fails on scope/unknown-tool so future failures are visible in the usage dashboard instead of silent.

## Verify after

Say "Pumpe einschalten" once, then check that a row appears in the tool audit and the token's `last_used_at` is set.
