## Landing page: cyberpunk-first, household-friendly

Replace the current `src/routes/index.tsx` landing with a bold, dark cyberpunk landing that still warmly invites non-technical household members. Routing, auth, agent backend, and `/cloud/*` UI stay untouched.

### Palette & feel
- Base: near-black `#07090A`, surface `#0E1412`
- Text: pastel mint-white `#E8FFF4`, muted `#9CB3A8`
- Primary accent: pastel green `#7CF0BD` (with glow `#A8FBD6`)
- Danger/alert accent (sparingly): coral red `#FF5C7A`
- Type: JetBrains Mono for code/labels + Space Grotesk for headlines, Inter for body
- Subtle scanline + grid background, soft green glow on primary CTAs, no purple, no gradients-to-white

### Sections (top to bottom)
1. **Hero**
   - Eyebrow: `pi-hub // self-hosted home OS`
   - Headline: "Your home, in your terminal — and in your kitchen."
   - Sub: one line for nerds (agent, MQTT, containers), one line for the household (just talk to it).
   - Primary CTA: `curl pi-hub.sh | sh` copy block + "Install on my Pi" button
   - Secondary: "Open dashboard" → `/cloud/devices`
   - Visual: terminal card with animated typing + a soft pastel-green pulse

2. **Voice + chat demo**
   - Mock chat bubbles alternating user ↔ agent ("dim the living room to 30%", "arm night mode", "is the dryer done?")
   - Mic button with pulsing ring, fake waveform
   - Tag: "Telegram, web, or voice — same agent."

3. **How it works (Pi ↔ Cloud)**
   - 3-node diagram: `Your Pi` ──(long-poll)── `pi-hub Cloud` ──`Telegram / Web`──
   - Three short bullets: outbound-only, your data stays on the Pi, per-user Telegram bot.

4. **For the whole household** (friendly counter-band, slightly lighter surface)
   - 3 cards: "Ask in plain language", "Works on the family phone", "No app store needed"

5. **Footer CTA**
   - Repeat install one-liner + link to `/auth`

### Technical notes
- Edit only `src/routes/index.tsx`; add small presentational components inline or under `src/components/landing/` (Hero, TerminalBlock, ChatDemo, PiCloudDiagram, HouseholdBand, FooterCta).
- Add tokens in `src/styles.css` under `@theme`: `--color-bg`, `--color-surface`, `--color-mint`, `--color-mint-glow`, `--color-coral`, plus `--font-display`, `--font-mono`.
- Load fonts via `<link>` in `src/routes/__root.tsx` head (Space Grotesk, Inter, JetBrains Mono) — no CSS `@import`.
- Animation via existing `framer-motion` (already a dep) for typed terminal + chat reveal; no new packages.
- Update `head()` in the index route: title, meta description, og:title/description, single H1.
- No backend, no schema, no auth changes.
