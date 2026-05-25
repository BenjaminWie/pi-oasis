import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { LogOut, Smartphone, Cpu, Shield } from "lucide-react";
import { auth } from "@/lib/auth-store";

export const Route = createFileRoute("/_authenticated/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  const navigate = useNavigate();

  const logout = () => {
    auth.clear();
    navigate({ to: "/login" });
  };

  return (
    <div className="px-4 pt-6 space-y-6">
      <header>
        <div className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground mb-1">
          Configuration
        </div>
        <h1 className="font-mono text-xl">System</h1>
      </header>

      <Section title="Host" icon={<Cpu className="size-4" />}>
        <Row label="Hostname" value="pi-cluster-01" />
        <Row label="Kernel" value="6.6.31-rpi" />
        <Row label="Dashboard" value="v2.0.4-β" />
      </Section>

      <Section title="Trusted devices" icon={<Smartphone className="size-4" />}>
        <Row label="iPhone · Safari" value="now" tone="ok" />
        <Row label="MacBook · Chrome" value="2h ago" />
        <button className="w-full mt-3 py-3 text-[10px] font-bold uppercase tracking-widest border border-border rounded-2xl text-muted-foreground active:scale-95 transition-transform">
          Revoke all
        </button>
      </Section>

      <Section title="Security" icon={<Shield className="size-4" />}>
        <button className="w-full py-3 text-[10px] font-bold uppercase tracking-widest bg-white/5 border border-border rounded-2xl active:scale-95 transition-transform">
          Change PIN
        </button>
      </Section>

      <button
        onClick={logout}
        className="w-full flex items-center justify-center gap-2 py-4 mt-4 bg-status-crit/10 border border-status-crit/30 text-status-crit rounded-2xl text-xs font-bold uppercase tracking-widest active:scale-95 transition-transform"
      >
        <LogOut className="size-4" />
        Disconnect
      </button>

      <p className="text-[10px] text-muted-foreground/50 font-mono text-center pt-4">
        pi-dashboard · running native on raspberrypi.local:3000
      </p>
    </div>
  );
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="flex items-center gap-2 mb-3 px-1">
        <span className="text-primary">{icon}</span>
        <h2 className="text-[10px] font-bold uppercase tracking-[0.3em] text-muted-foreground">
          {title}
        </h2>
      </div>
      <div className="bg-card border border-border rounded-3xl p-4 space-y-2">{children}</div>
    </section>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: "ok" }) {
  return (
    <div className="flex justify-between items-center py-2 border-b border-border/50 last:border-0">
      <span className="text-sm text-foreground">{label}</span>
      <span
        className={`font-mono text-xs ${tone === "ok" ? "text-status-ok" : "text-muted-foreground"}`}
      >
        {value}
      </span>
    </div>
  );
}
