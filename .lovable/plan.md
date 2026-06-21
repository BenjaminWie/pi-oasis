## Goal
Make the landing page point to `pi-hub.benniwie.com` and improve the Raspberry Pi install/deployment experience so it no longer loops on missing `.output/server/index.mjs` artifacts.

## Changes to implement

1. **Landing page domain update**
   - Replace the public install command with the requested domain, e.g. `curl -fsSL https://pi-hub.benniwie.com/install.sh | sh`.
   - Add or update landing-page copy so `pi-hub.benniwie.com` is visible as the canonical install/source domain.
   - Keep the existing cyberpunk pastel-green visual direction unchanged.

2. **Fix the production start path mismatch**
   - Update `scripts/start.sh` so it checks for and starts the actual TanStack/Vite production output path: `dist/server/server.js`.
   - Remove the current behavior where a missing `.output` directory triggers `./scripts/install.sh` at runtime.
   - Make startup fail cleanly with a clear message telling the user to run the install/build step if the production artifact is missing.

3. **Improve install script messaging**
   - Keep `scripts/install.sh` responsible for dependency installation, `.env` creation, and `npm run build`.
   - After build, verify `dist/server/server.js` exists and print actionable next steps.
   - Update naming from the older `pi-dashboard` language toward `pi-hub` where user-facing.

4. **Add PM2 support as the recommended headless runtime**
   - Add an `ecosystem.config.cjs` (or JSON if compatible with comments removed) that runs `dist/server/server.js` with `PORT=3000`, `HOST=0.0.0.0`, restart delay, and memory cap.
   - Add a PM2 install/start path to README and DEPLOY docs.
   - Keep systemd as an optional fallback, but fix its `ExecStart` to use `dist/server/server.js` and avoid brittle `.output` assumptions.

5. **Refresh deployment docs**
   - Update README and DEPLOY.md to describe:
     - the corrected build artifact path,
     - why runtime scripts should not build/install automatically,
     - PM2 as the recommended production background process,
     - systemd only as an alternative.
   - Preserve the current Raspberry Pi / Docker / mobile dashboard positioning.

## Technical notes
- I will not change backend schemas, auth, or cloud functions.
- I will avoid changing the existing app architecture or visual design beyond the requested domain/install copy.
- After implementation, I will validate by inspecting the edited files and, where possible, running a non-build syntax/path check rather than manually triggering a production build.