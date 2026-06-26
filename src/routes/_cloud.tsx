import { createFileRoute, Outlet, Link, useNavigate, useLocation } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Server, MessageCircle, ScrollText, LogOut, Bot } from "lucide-react";

export const Route = createFileRoute("/_cloud")({
  ssr: false,
  component: CloudLayout,
});

function CloudLayout() {
  const navigate = useNavigate();
  const loc = useLocation();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      if (!data.session) {
        navigate({ to: "/auth" });
      } else {
        setReady(true);
      }
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") navigate({ to: "/auth" });
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [navigate]);

  if (!ready) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center text-xs text-muted-foreground font-mono">
        Verbinde...
      </div>
    );
  }

  const tabs = [
    { to: "/devices", label: "Geräte", icon: Server },
    { to: "/telegram", label: "Telegram", icon: MessageCircle },
    { to: "/audit", label: "Audit", icon: ScrollText },
    { to: "/cloud/devices", label: "Geräte", icon: Server },
    { to: "/cloud/mcp", label: "MCP", icon: Bot },
    { to: "/cloud/telegram", label: "Telegram", icon: MessageCircle },
    { to: "/cloud/audit", label: "Audit", icon: ScrollText },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground max-w-md mx-auto pb-28">
      <header className="flex items-center justify-between px-5 pt-6 pb-4">
        <div>
          <h1 className="text-lg font-mono font-bold text-primary">PI HUB</h1>
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Cloud Control
          </p>
        </div>
        <button
          onClick={async () => {
            await supabase.auth.signOut();
          }}
          className="text-xs text-muted-foreground flex items-center gap-1"
          aria-label="Abmelden"
        >
          <LogOut size={14} />
        </button>
      </header>

      <Outlet />

      <nav className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-md border-t border-border bg-card/95 backdrop-blur">
        <div className="grid grid-cols-4">
          {tabs.map((t) => {
            const active = loc.pathname.startsWith(t.to);
            const Icon = t.icon;
            return (
              <Link
                key={t.to}
                to={t.to}
                className={`flex flex-col items-center py-3 text-[10px] uppercase tracking-widest ${
                  active ? "text-primary" : "text-muted-foreground"
                }`}
              >
                <Icon size={18} />
                <span className="mt-1">{t.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
