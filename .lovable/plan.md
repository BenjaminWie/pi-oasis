Add a new section to the landing page (`src/routes/index.tsx`) that clearly sells the architecture benefit: the Pi never needs an open port, public IP, or dynamic DNS because it long-polls the cloud outbound-only.

### What to change

1. **New section between Hero and ChatDemo** (or inside HowItWorks) — a concise "No DNS hustle" block with:
   - Headline like "No port forwarding. No dynamic DNS. No exposed Pi."
   - One-paragraph explanation: Pi opens an outbound HTTPS long-poll to the cloud. Commands ride back on the same connection. Your router and ISP can't tell the difference from a normal browser request.
   - Visual: a simple 3-step diagram (Pi → cloud → your phone) with arrows emphasizing outbound-only.
   - A small call-out badge: "Your Pi stays invisible on the internet."

2. **Tweak the existing HowItWorks section** — add a bullet or sub-line under "Outbound only" that explicitly calls out: "No DDNS, no port 80/443 forwarding, no firewall rules."

3. **Tweak the existing Hero paragraph** — add one short sentence after the existing geek/everyone-else lines: "And because your Pi talks out, not in, you skip every router tutorial you were dreading."

### Why this matters for the user
- The current landing page already says "no open ports" but doesn't explicitly name the pain everyone knows: setting up DuckDNS, port forwarding, reverse proxies, or exposing a home server to the internet.
- Naming the problem directly ("DNS hustles") makes the solution feel more valuable.
- This is copy + minor layout changes only — no backend logic.

### Files to touch
- `src/routes/index.tsx` — add the new section and tweak existing copy