import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { getProfile, linkTelegramBot, unlinkTelegramBot } from "@/lib/cloud.functions";

export const Route = createFileRoute("/_cloud/connections/telegram")({
  component: TelegramPage,
});

function TelegramPage() {
  const fetchProfile = useServerFn(getProfile);
  const link = useServerFn(linkTelegramBot);
  const unlink = useServerFn(unlinkTelegramBot);
  const qc = useQueryClient();
  const [token, setToken] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const { data: profile } = useQuery({
    queryKey: ["profile"],
    queryFn: () => fetchProfile(),
  });

  const linkMut = useMutation({
    mutationFn: () => link({ data: { token } }),
    onSuccess: () => {
      setToken("");
      setErr(null);
      qc.invalidateQueries({ queryKey: ["profile"] });
    },
    onError: (e: any) => setErr(e.message),
  });

  const unlinkMut = useMutation({
    mutationFn: () => unlink({}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["profile"] }),
  });

  const linked = !!profile?.telegram_bot_username;
  const chatLinked = !!profile?.telegram_chat_id;

  return (
    <div className="px-5 space-y-4">
      <Link
        to="/connections"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground mb-2"
      >
        <ArrowLeft size={14} /> zurück
      </Link>

      <h2 className="text-xs uppercase tracking-widest text-muted-foreground">Telegram-Bot</h2>

      {!linked ? (
        <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
          <ol className="text-xs space-y-2 text-muted-foreground list-decimal list-inside">
            <li>In Telegram: @BotFather öffnen, /newbot, Anweisungen folgen</li>
            <li>
              Token (Format <code className="text-primary">123:ABC...</code>) hier einfügen
            </li>
            <li>Speichern → Webhook wird automatisch gesetzt</li>
          </ol>
          <input
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="123456:ABCdef..."
            className="w-full rounded-lg bg-background border border-border px-3 py-2 font-mono text-xs"
          />
          {err && <p className="text-xs text-destructive">{err}</p>}
          <button
            onClick={() => linkMut.mutate()}
            disabled={!token || linkMut.isPending}
            className="w-full rounded-lg bg-primary text-primary-foreground py-2 text-xs uppercase tracking-widest disabled:opacity-50"
          >
            {linkMut.isPending ? "..." : "Bot verbinden"}
          </button>
        </div>
      ) : (
        <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase tracking-widest text-muted-foreground">Bot</span>
            <span className="font-mono text-primary">@{profile.telegram_bot_username}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase tracking-widest text-muted-foreground">Chat</span>
            <span className="font-mono text-xs">
              {chatLinked ? "verknüpft" : "noch nicht verknüpft"}
            </span>
          </div>

          {!chatLinked && (
            <div className="rounded-lg bg-background border border-border p-3 text-xs space-y-1">
              <p className="text-muted-foreground">
                In Telegram an @{profile.telegram_bot_username}:
              </p>
              <p className="font-mono text-primary">/link {profile.telegram_link_code}</p>
            </div>
          )}

          <div className="text-[10px] text-muted-foreground space-y-1 pt-2">
            <p className="uppercase tracking-widest">Verfügbare Befehle</p>
            <p className="font-mono">
              /devices · /status · /containers · /mqtt pub &lt;topic&gt; &lt;msg&gt;
            </p>
          </div>

          <button
            onClick={() => unlinkMut.mutate()}
            className="w-full rounded-lg border border-destructive/40 text-destructive py-2 text-xs uppercase tracking-widest"
          >
            Bot trennen
          </button>
        </div>
      )}
    </div>
  );
}
