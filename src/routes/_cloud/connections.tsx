import { createFileRoute, Link, useLocation } from "@tanstack/react-router";
import { Bot, MessageCircle, Mic } from "lucide-react";

export const Route = createFileRoute("/_cloud/connections")({
  component: ConnectionsPage,
});

function ConnectionsPage() {
  const loc = useLocation();

  const sections = [
    {
      id: "mcp",
      label: "MCP Server",
      icon: Bot,
      description: "Verbinde ChatGPT, Gemini, Claude oder andere Modelle.",
      href: "/connections/mcp",
    },
    {
      id: "telegram",
      label: "Telegram Bot",
      icon: MessageCircle,
      description: "Steuere deinen Pi über Telegram Nachrichten oder Sprache.",
      href: "/connections/telegram",
    },
    {
      id: "alexa",
      label: "Alexa Skill",
      icon: Mic,
      description: "Steuere deinen Pi mit Amazon Alexa Sprachbefehlen.",
      href: "/connections/alexa",
    },
  ];

  return (
    <div className="px-5 space-y-6">
      <div>
        <h2 className="text-xs uppercase tracking-widest text-muted-foreground mb-1">
          Connections
        </h2>
        <p className="text-xs text-muted-foreground">
          Verwalte externe Zugänge und KI-Integrationen für dein Pi-Netzwerk.
        </p>
      </div>

      <div className="space-y-3">
        {sections.map((s) => (
          <Link
            key={s.id}
            to={s.href}
            className="flex items-center gap-4 rounded-2xl border border-border bg-card p-4 active:scale-[0.98] transition-transform"
          >
            <div className="rounded-xl bg-primary/10 p-3 text-primary">
              <s.icon size={24} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-bold text-sm">{s.label}</div>
              <div className="text-[11px] text-muted-foreground leading-tight">
                {s.description}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
