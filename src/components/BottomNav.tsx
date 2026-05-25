import { Link, useRouterState } from "@tanstack/react-router";
import { Activity, TerminalSquare, Settings as SettingsIcon } from "lucide-react";

const tabs = [
  { to: "/overview", label: "Overview", icon: Activity },
  { to: "/terminal", label: "Terminal", icon: TerminalSquare },
  { to: "/settings", label: "System", icon: SettingsIcon },
] as const;

export function BottomNav() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <nav
      className="fixed bottom-0 inset-x-0 z-40 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 bg-background/80 backdrop-blur-xl border-t border-border"
      aria-label="Primary"
    >
      <div className="max-w-md mx-auto flex items-center justify-around">
        {tabs.map(({ to, label, icon: Icon }) => {
          const active = pathname === to || pathname.startsWith(to + "/");
          return (
            <Link
              key={to}
              to={to}
              className="flex flex-col items-center gap-1 py-2 px-4 rounded-2xl transition-colors"
              aria-current={active ? "page" : undefined}
            >
              <div
                className={`size-10 rounded-2xl grid place-items-center transition-all ${
                  active
                    ? "bg-primary/15 text-primary glow-accent"
                    : "bg-transparent text-muted-foreground"
                }`}
              >
                <Icon className="size-5" strokeWidth={active ? 2.2 : 1.6} />
              </div>
              <span
                className={`text-[10px] font-semibold uppercase tracking-widest ${
                  active ? "text-primary" : "text-muted-foreground"
                }`}
              >
                {label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
