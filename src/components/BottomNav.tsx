import { Link, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Activity,
  TerminalSquare,
  Settings as SettingsIcon,
  Radio,
  Puzzle,
  Zap,
} from "lucide-react";
import { listMqttBrokers } from "@/lib/mqtt/mqtt.functions";

const baseTabs = [
  { to: "/overview", label: "Overview", icon: Activity },
  { to: "/events", label: "Events", icon: Zap },
  { to: "/plugins", label: "Plugins", icon: Puzzle },
  { to: "/terminal", label: "Terminal", icon: TerminalSquare },
  { to: "/settings", label: "System", icon: SettingsIcon },
] as const;

export function BottomNav() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const brokersFn = useServerFn(listMqttBrokers);

  const brokers = useQuery({
    queryKey: ["mqtt-brokers"],
    queryFn: () => brokersFn(),
    refetchInterval: 30000,
    refetchIntervalInBackground: false,
    staleTime: 30000,
  });

  const hasMqtt = (brokers.data?.length ?? 0) > 0;

  const tabs = hasMqtt
    ? [
        baseTabs[0],
        { to: "/mqtt", label: "MQTT", icon: Radio } as const,
        baseTabs[1],
        baseTabs[2],
        baseTabs[3],
        baseTabs[4],
      ]
    : [...baseTabs];

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
              className="flex flex-col items-center gap-1 py-2 px-3 rounded-2xl transition-colors"
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
