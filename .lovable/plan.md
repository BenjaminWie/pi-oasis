# Add Change PIN to the Login view

The login screen (`/login`) currently only accepts a 4-digit PIN to unlock. There is no entry point to change the PIN unless the user is already authenticated and on `/settings`. This plan adds the change/reset flow directly to the login view, and tightens a couple of related interactions.

## What changes for the user

1. Under the PIN keypad on `/login`, two new small text links:
   - **Change PIN** — opens a modal asking for current PIN + new PIN (4–8 digits, confirm field). Submits to the existing `changePin` server fn. Because `changePin` requires auth, the modal first calls `verifyPin` with the current PIN to mint a token, stores it via `auth.setToken`, then calls `changePin`. On success: toast + auto-fill the new PIN into the keypad dots and continue the normal login.
   - **Forgot PIN?** — opens a modal asking for the factory token + new PIN. Calls the existing `resetPinWithFactoryToken` server fn (no auth required). On success: same auto-login behaviour.

2. The existing settings page modals stay; this just adds a second entry point.

## Technical details

- File touched: `src/routes/login.tsx` only (plus tiny shared modal extraction if useful — otherwise inline).
- Reuse existing server fns from `src/lib/auth.functions.ts`: `verifyPin`, `changePin`, `resetPinWithFactoryToken`. No backend changes.
- Add a confirm-new-PIN field (currently the settings modal lacks it — easy bug). Apply the same field to the settings `ChangePinModal` for consistency.
- Numeric `inputMode`, `maxLength=8`, mask with `type="password"`.
- After a successful change/reset, call `verifyPin` with the new PIN + `trust` flag from the login checkbox to issue a token and navigate to `/overview`, so the user is logged in immediately.
- Error states: show inline red text, never throw to the route boundary.
- No changes to routing, auth middleware, or styling tokens.

## Out of scope

- Cloud bridge, terminal, MQTT wiring.
- Redesign of the keypad.
- Rate-limiting the PIN change endpoint (already gated by `requirePiAuth` for change, factory token for reset).
