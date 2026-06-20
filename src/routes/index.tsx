import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: Landing,
});

function Landing() {
  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-4xl font-mono font-bold text-primary">PI HUB</h1>
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground mt-2">
            Industrial Control · Cyberpunk Edition
          </p>
        </div>

        <Link
          to="/auth"
          className="block rounded-2xl border border-primary bg-card p-6 hover:bg-primary/5 transition"
        >
          <h2 className="font-bold uppercase tracking-widest text-sm text-primary">
            Cloud Verwaltung
          </h2>
          <p className="text-xs text-muted-foreground mt-2">
            Geräte registrieren, Telegram-Bot verbinden, Pi aus dem Internet steuern.
          </p>
        </Link>

        <Link
          to="/login"
          className="block rounded-2xl border border-border bg-card p-6 hover:bg-muted/40 transition"
        >
          <h2 className="font-bold uppercase tracking-widest text-sm">
            Pi-Local Dashboard
          </h2>
          <p className="text-xs text-muted-foreground mt-2">
            Direkter PIN-Zugang im Heimnetz. Live-Stats, Terminal, MQTT-Inspector.
          </p>
        </Link>
      </div>
    </div>
  );
}
