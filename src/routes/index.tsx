import { createFileRoute, Link } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { Check, Copy, Mic, Terminal, Cpu, Cloud, MessageSquare, Shield, Radio, Home } from "lucide-react";

export const Route = createFileRoute("/")({
  component: Landing,
});

const INSTALL_CMD = "curl -fsSL pi-hub.sh | sh";

function Landing() {
  return (
    <div className="min-h-screen bg-background text-foreground font-sans antialiased overflow-x-hidden">
      <NavBar />
      <Hero />
      <ChatDemo />
      <HowItWorks />
      <HouseholdBand />
      <FooterCta />
    </div>
  );
}

/* -------------------- Nav -------------------- */

function NavBar() {
  return (
    <header className="sticky top-0 z-40 backdrop-blur-md bg-background/70 border-b border-border">
      <div className="mx-auto max-w-6xl px-5 h-14 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-primary glow-mint" />
          <span className="font-mono text-sm tracking-widest text-primary">pi-hub</span>
          <span className="font-mono text-[10px] text-muted-foreground hidden sm:inline">// v1</span>
        </Link>
        <nav className="flex items-center gap-2">
          <Link
            to="/cloud/devices"
            className="hidden sm:inline-flex px-3 py-1.5 text-xs font-mono uppercase tracking-widest text-muted-foreground hover:text-foreground transition"
          >
            Dashboard
          </Link>
          <Link
            to="/auth"
            className="px-3 py-1.5 text-xs font-mono uppercase tracking-widest rounded-md border border-border hover:border-primary hover:text-primary transition"
          >
            Sign in
          </Link>
        </nav>
      </div>
    </header>
  );
}

/* -------------------- Hero -------------------- */

function Hero() {
  return (
    <section className="relative">
      <div className="absolute inset-0 grid-bg opacity-40 pointer-events-none" />
      <div className="absolute inset-0 scanlines opacity-[0.18] pointer-events-none" />
      <div
        className="absolute -top-40 left-1/2 -translate-x-1/2 h-[560px] w-[900px] rounded-full pointer-events-none"
        style={{ background: "radial-gradient(closest-side, oklch(0.89 0.16 160 / 0.18), transparent 70%)" }}
      />

      <div className="relative mx-auto max-w-6xl px-5 pt-20 pb-24 lg:pt-28 lg:pb-32">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/5 px-3 py-1 text-[11px] font-mono uppercase tracking-widest text-primary"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
          pi-hub // self-hosted home OS
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.05 }}
          className="mt-6 font-display text-4xl sm:text-5xl lg:text-7xl font-bold leading-[1.05] tracking-tight max-w-4xl"
          style={{ fontFamily: "var(--font-display)" }}
        >
          Your home,{" "}
          <span className="text-primary text-glow-mint">in your terminal</span>
          <br className="hidden sm:block" /> — and in your kitchen.
        </motion.h1>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.15 }}
          className="mt-6 max-w-2xl space-y-2 text-base sm:text-lg text-muted-foreground"
        >
          <p>
            <span className="font-mono text-primary">$</span> For the geeks: an agent that drives
            MQTT, containers, scripts, and your Pi — over SSH-free long-polling.
          </p>
          <p>
            <span className="text-coral">♥</span> For everyone else: just ask. "Dim the kitchen."
            "Is the dryer done?" "Goodnight." That's it.
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.25 }}
          className="mt-10 grid lg:grid-cols-2 gap-6 items-start"
        >
          <div className="space-y-4">
            <InstallBlock />
            <div className="flex flex-wrap gap-3">
              <a
                href="#install"
                className="inline-flex items-center gap-2 rounded-md bg-primary text-primary-foreground px-5 py-3 text-sm font-mono uppercase tracking-widest font-bold glow-mint hover:brightness-110 transition"
              >
                <Terminal className="h-4 w-4" />
                Install on my Pi
              </a>
              <Link
                to="/cloud/devices"
                className="inline-flex items-center gap-2 rounded-md border border-border px-5 py-3 text-sm font-mono uppercase tracking-widest hover:border-primary hover:text-primary transition"
              >
                Open dashboard
              </Link>
            </div>
            <p className="text-xs font-mono text-muted-foreground">
              Works on Raspberry Pi 3/4/5 · Debian/Ubuntu · ~30s to first boot.
            </p>
          </div>

          <TerminalCard />
        </motion.div>
      </div>
    </section>
  );
}

function InstallBlock() {
  const [copied, setCopied] = useState(false);
  return (
    <div
      id="install"
      className="group relative rounded-lg border border-primary/30 bg-card/60 backdrop-blur p-4 font-mono text-sm flex items-center gap-3"
    >
      <span className="text-primary select-none">$</span>
      <code className="flex-1 truncate text-foreground">{INSTALL_CMD}</code>
      <button
        onClick={async () => {
          await navigator.clipboard.writeText(INSTALL_CMD);
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        }}
        className="inline-flex items-center gap-1.5 rounded border border-border px-2 py-1 text-[11px] uppercase tracking-widest text-muted-foreground hover:text-primary hover:border-primary transition"
        aria-label="Copy install command"
      >
        {copied ? <Check className="h-3.5 w-3.5 text-primary" /> : <Copy className="h-3.5 w-3.5" />}
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

function TerminalCard() {
  const lines = [
    { p: "$", t: "pi-agent register --code 7F-2K-91" },
    { p: ">", t: "✓ paired with cloud · device=raspberry-kitchen" },
    { p: "$", t: "systemctl status pi-agent" },
    { p: ">", t: "● pi-agent.service — active (running)" },
    { p: ">", t: "  long-poll → cloud  |  mqtt → 192.168.1.20" },
    { p: "$", t: "_" },
  ];
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (shown >= lines.length) return;
    const t = setTimeout(() => setShown((n) => n + 1), 520);
    return () => clearTimeout(t);
  }, [shown, lines.length]);

  return (
    <div className="rounded-xl border border-border bg-card/80 backdrop-blur shadow-2xl glow-mint overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-background/60">
        <span className="h-2.5 w-2.5 rounded-full bg-coral/80" />
        <span className="h-2.5 w-2.5 rounded-full bg-primary/40" />
        <span className="h-2.5 w-2.5 rounded-full bg-primary" />
        <span className="ml-3 text-[11px] font-mono text-muted-foreground">
          ~/pi-hub · zsh
        </span>
      </div>
      <div className="p-5 font-mono text-[13px] leading-relaxed min-h-[230px]">
        {lines.slice(0, shown).map((l, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
            className="flex gap-3"
          >
            <span className={l.p === "$" ? "text-primary" : "text-muted-foreground"}>{l.p}</span>
            <span
              className={
                l.t.startsWith("✓") || l.t.startsWith("●")
                  ? "text-primary"
                  : "text-foreground/90"
              }
            >
              {l.t}
              {i === shown - 1 && l.t === "_" && (
                <span className="inline-block w-2 h-4 bg-primary ml-0.5 align-middle animate-pulse" />
              )}
            </span>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

/* -------------------- Chat Demo -------------------- */

function ChatDemo() {
  const messages = [
    { from: "user", text: "Dim the kitchen to 30%." },
    { from: "agent", text: "Done. Kitchen ceiling at 30%. Want the under-cabinet warm too?" },
    { from: "user", text: "Yeah, and is the dryer finished?" },
    { from: "agent", text: "Dryer cycle ended 4 min ago. Energy: 0.42 kWh." },
    { from: "user", text: "Arm night mode in 20." },
    { from: "agent", text: "Scheduled. I'll lock doors, dim hallway to 5%, and mute Telegram alerts." },
  ];

  return (
    <section className="relative py-24 border-t border-border">
      <div className="absolute inset-0 grid-bg opacity-20 pointer-events-none" />
      <div className="relative mx-auto max-w-6xl px-5">
        <SectionLabel icon={<MessageSquare className="h-3.5 w-3.5" />}>
          voice + chat demo
        </SectionLabel>
        <h2
          className="mt-4 font-display text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight max-w-3xl"
          style={{ fontFamily: "var(--font-display)" }}
        >
          Telegram, web, or voice — <span className="text-primary text-glow-mint">same agent.</span>
        </h2>
        <p className="mt-4 text-muted-foreground max-w-2xl">
          No menus. No 12-tap routines. Talk to your home like a competent roommate
          that happens to speak fluent MQTT.
        </p>

        <div className="mt-12 grid lg:grid-cols-[1fr_auto] gap-8 items-center">
          <div className="rounded-2xl border border-border bg-card/70 backdrop-blur p-5 sm:p-7 space-y-3">
            {messages.map((m, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 6 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-80px" }}
                transition={{ duration: 0.35, delay: i * 0.12 }}
                className={`flex ${m.from === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={
                    m.from === "user"
                      ? "max-w-[80%] rounded-2xl rounded-br-sm bg-primary text-primary-foreground px-4 py-2.5 text-sm font-medium"
                      : "max-w-[80%] rounded-2xl rounded-bl-sm border border-primary/25 bg-background/60 text-foreground px-4 py-2.5 text-sm font-mono"
                  }
                >
                  {m.text}
                </div>
              </motion.div>
            ))}
          </div>

          <MicOrb />
        </div>
      </div>
    </section>
  );
}

function MicOrb() {
  return (
    <div className="relative mx-auto h-56 w-56 flex items-center justify-center">
      <motion.div
        animate={{ scale: [1, 1.15, 1], opacity: [0.5, 0.2, 0.5] }}
        transition={{ duration: 2.6, repeat: Infinity, ease: "easeInOut" }}
        className="absolute inset-0 rounded-full border border-primary/40"
      />
      <motion.div
        animate={{ scale: [1, 1.3, 1], opacity: [0.4, 0.1, 0.4] }}
        transition={{ duration: 2.6, repeat: Infinity, ease: "easeInOut", delay: 0.4 }}
        className="absolute inset-2 rounded-full border border-primary/30"
      />
      <div className="relative h-32 w-32 rounded-full bg-primary text-primary-foreground flex items-center justify-center glow-mint">
        <Mic className="h-12 w-12" />
      </div>
      <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 flex items-end gap-1 h-8">
        {[0.4, 0.8, 0.6, 1, 0.5, 0.9, 0.4].map((h, i) => (
          <motion.span
            key={i}
            animate={{ scaleY: [h, h * 0.3, h] }}
            transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.07, ease: "easeInOut" }}
            className="w-1 origin-bottom bg-primary rounded-full"
            style={{ height: `${h * 28}px` }}
          />
        ))}
      </div>
    </div>
  );
}

/* -------------------- How it works -------------------- */

function HowItWorks() {
  return (
    <section className="relative py-24 border-t border-border bg-card/30">
      <div className="absolute inset-0 grid-bg opacity-30 pointer-events-none" />
      <div className="relative mx-auto max-w-6xl px-5">
        <SectionLabel icon={<Cpu className="h-3.5 w-3.5" />}>how it works</SectionLabel>
        <h2
          className="mt-4 font-display text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight max-w-3xl"
          style={{ fontFamily: "var(--font-display)" }}
        >
          Pi ↔ Cloud, <span className="text-primary text-glow-mint">outbound only.</span>
        </h2>
        <p className="mt-4 text-muted-foreground max-w-2xl">
          Your Pi long-polls the cloud — no inbound ports, no router config, no exposed services.
          Commands ride back on the same connection.
        </p>

        <div className="mt-14 grid md:grid-cols-3 gap-6 items-stretch">
          <DiagramNode icon={<Home className="h-6 w-6" />} title="Your Pi" lines={["pi-agent.service", "MQTT · Docker · scripts"]} />
          <DiagramArrow label="long-poll · HTTPS" />
          <DiagramNode icon={<Cloud className="h-6 w-6" />} title="pi-hub cloud" lines={["queues commands", "no shell access"]} />
        </div>

        <div className="mt-6 grid md:grid-cols-3 gap-6 items-stretch">
          <DiagramNode icon={<MessageSquare className="h-6 w-6" />} title="Your Telegram" lines={["1 bot per user", "voice + text"]} />
          <DiagramArrow label="webhook · per-user" reverse />
          <DiagramNode icon={<Cloud className="h-6 w-6" />} title="pi-hub cloud" lines={["routes to your device", "audit log"]} />
        </div>

        <div className="mt-12 grid sm:grid-cols-3 gap-4">
          <Bullet icon={<Shield className="h-4 w-4" />} title="Outbound only" body="No open ports on your home network. Ever." />
          <Bullet icon={<Radio className="h-4 w-4" />} title="Your data, your Pi" body="MQTT, sensor history, scenes — stays on device." />
          <Bullet icon={<MessageSquare className="h-4 w-4" />} title="Per-user Telegram bot" body="One bot per user, scoped to your devices only." />
        </div>
      </div>
    </section>
  );
}

function DiagramNode({ icon, title, lines }: { icon: React.ReactNode; title: string; lines: string[] }) {
  return (
    <div className="rounded-xl border border-primary/25 bg-background/60 backdrop-blur p-5 flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <span className="h-9 w-9 rounded-lg bg-primary/15 text-primary flex items-center justify-center">
          {icon}
        </span>
        <span className="font-display font-bold text-lg" style={{ fontFamily: "var(--font-display)" }}>{title}</span>
      </div>
      <div className="font-mono text-[12px] text-muted-foreground space-y-0.5">
        {lines.map((l) => (
          <div key={l}>· {l}</div>
        ))}
      </div>
    </div>
  );
}

function DiagramArrow({ label, reverse = false }: { label: string; reverse?: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[64px]">
      <div className="font-mono text-[11px] uppercase tracking-widest text-primary">{label}</div>
      <div className="mt-2 flex items-center gap-1 text-primary">
        {reverse ? <span>←</span> : <span>→</span>}
        <span className="h-px w-20 bg-primary/50" />
        {reverse ? <span>•</span> : <span>→</span>}
      </div>
    </div>
  );
}

function Bullet({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="rounded-lg border border-border bg-background/40 p-4">
      <div className="flex items-center gap-2 text-primary">
        {icon}
        <span className="font-mono text-xs uppercase tracking-widest">{title}</span>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">{body}</p>
    </div>
  );
}

/* -------------------- Household band -------------------- */

function HouseholdBand() {
  const cards = [
    {
      icon: <MessageSquare className="h-5 w-5" />,
      title: "Ask in plain language",
      body: "No app to learn. No buttons to memorize. Type or speak the way you'd ask anyone in the house.",
    },
    {
      icon: <Home className="h-5 w-5" />,
      title: "Works on the family phone",
      body: "Telegram is the remote. Everyone in the household already has it — kids included.",
    },
    {
      icon: <Shield className="h-5 w-5" />,
      title: "No app store. No subscriptions",
      body: "One install on your Pi. The rest is just chat. Spouse-approved.",
    },
  ];
  return (
    <section className="relative py-24 border-t border-border">
      <div className="relative mx-auto max-w-6xl px-5">
        <SectionLabel icon={<Home className="h-3.5 w-3.5" />}>for the whole household</SectionLabel>
        <h2
          className="mt-4 font-display text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight max-w-3xl"
          style={{ fontFamily: "var(--font-display)" }}
        >
          Not just for the person who{" "}
          <span className="text-primary text-glow-mint">flashed the SD card.</span>
        </h2>
        <div className="mt-12 grid md:grid-cols-3 gap-5">
          {cards.map((c) => (
            <div
              key={c.title}
              className="rounded-2xl border border-border bg-card/60 backdrop-blur p-6 hover:border-primary/50 transition"
            >
              <div className="h-10 w-10 rounded-lg bg-primary/15 text-primary flex items-center justify-center">
                {c.icon}
              </div>
              <h3 className="mt-4 font-display text-lg font-bold" style={{ fontFamily: "var(--font-display)" }}>
                {c.title}
              </h3>
              <p className="mt-2 text-sm text-muted-foreground">{c.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* -------------------- Footer CTA -------------------- */

function FooterCta() {
  return (
    <section className="relative py-20 border-t border-border bg-card/40">
      <div className="absolute inset-0 grid-bg opacity-30 pointer-events-none" />
      <div className="relative mx-auto max-w-3xl px-5 text-center">
        <h2
          className="font-display text-3xl sm:text-4xl font-bold tracking-tight"
          style={{ fontFamily: "var(--font-display)" }}
        >
          One command. <span className="text-primary text-glow-mint">Your home, online.</span>
        </h2>
        <p className="mt-3 text-muted-foreground">
          Free, open, self-hosted. Ditch the clunky dashboard — keep the power.
        </p>
        <div className="mt-8 max-w-md mx-auto">
          <InstallBlock />
        </div>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <Link
            to="/auth"
            className="inline-flex items-center gap-2 rounded-md bg-primary text-primary-foreground px-5 py-3 text-sm font-mono uppercase tracking-widest font-bold glow-mint hover:brightness-110 transition"
          >
            Create account
          </Link>
          <Link
            to="/cloud/devices"
            className="inline-flex items-center gap-2 rounded-md border border-border px-5 py-3 text-sm font-mono uppercase tracking-widest hover:border-primary hover:text-primary transition"
          >
            Open dashboard
          </Link>
        </div>
        <p className="mt-10 text-[11px] font-mono uppercase tracking-widest text-muted-foreground">
          pi-hub · self-hosted · made for tinkerers · loved by the household
        </p>
      </div>
    </section>
  );
}

/* -------------------- Helpers -------------------- */

function SectionLabel({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/5 px-3 py-1 text-[11px] font-mono uppercase tracking-widest text-primary">
      {icon}
      {children}
    </div>
  );
}
