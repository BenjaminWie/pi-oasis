import { createFileRoute, Link } from "@tanstack/react-router";
import { Bot, MessageCircle, Mic, ChevronRight } from "lucide-react";

export const Route = createFileRoute("/_cloud/connections")({
  component: ConnectionsPage,
});

function ConnectionsPage() {
  return (
    <div className="px-5 space-y-6">
      <div>
        <h2 className="text-xs uppercase tracking-widest text-muted-foreground mb-1">
          Connect
        </h2>
        <p className="text-xs text-muted-foreground">
          Externe Zugänge, die mit deiner Pumpe und deinen Geräten sprechen.
        </p>
      </div>

      <div className="space-y-3">
        <Link
          to="/connections/mcp"
          className="flex items-center gap-4 rounded-2xl border border-border bg-card p-4 hover:bg-muted/40 active:scale-[0.98] transition-all"
        >
          <div className="rounded-xl bg-primary/10 p-3 text-primary">
            <Bot size={24} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-bold text-sm">MCP Server</div>
            <div className="text-[11px] text-muted-foreground leading-tight">
              ChatGPT, Gemini, Claude per API-Token an deinen Pi binden.
            </div>
          </div>
          <ChevronRight size={16} className="text-muted-foreground" />
        </Link>

        <Link
          to="/connections/telegram"
          className="flex items-center gap-4 rounded-2xl border border-border bg-card p-4 hover:bg-muted/40 active:scale-[0.98] transition-all"
        >
          <div className="rounded-xl bg-primary/10 p-3 text-primary">
            <MessageCircle size={24} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-bold text-sm">Telegram Bot</div>
            <div className="text-[11px] text-muted-foreground leading-tight">
              Status & Steuerung per Nachricht oder Sprachmemo.
            </div>
          </div>
          <ChevronRight size={16} className="text-muted-foreground" />
        </Link>

        <Link
          to="/connections/alexa"
          className="flex items-center gap-4 rounded-2xl border border-border bg-card p-4 hover:bg-muted/40 active:scale-[0.98] transition-all"
        >
          <div className="rounded-xl bg-primary/10 p-3 text-primary">
            <Mic size={24} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-bold text-sm">Alexa Skill</div>
            <div className="text-[11px] text-muted-foreground leading-tight">
              "Alexa, sage Pi Hub: Pumpe an für 10 Minuten."
            </div>
          </div>
          <ChevronRight size={16} className="text-muted-foreground" />
        </Link>
      </div>
    </div>
  );
}
