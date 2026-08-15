import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ArrowLeft, CheckCircle2, XCircle } from "lucide-react";
import { getWiringStatus, installTelegramWebhook } from "@/lib/wiring.functions";

export const Route = createFileRoute("/_cloud/connections/telegram")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Telegram Bot — Pi Hub" },
      {
        name: "description",
        content: "Telegram-Bot ohne Datenbank: Bot-Token als Secret, Webhook setzen, Chat freischalten.",
      },
      { property: "og:title", content: "Telegram Bot — Pi Hub" },
      { property: "og:description", content: "Status, Steuerung und Sprachmemos per Telegram." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TelegramPage,
});

function TelegramPage() {
  const statusFn = useServerFn(getWiringStatus);
  const installFn = useServerFn(installTelegramWebhook);
  const qc = useQueryClient();
  const [err, setErr] = useState<string | null>(null);

  const { data } = useQuery({ queryKey: ["wiring-status"], queryFn: () => statusFn() });
  const tg = data?.telegram;

  const install = useMutation({
    mutationFn: () => installFn({}),
    onSuccess: () => {
      setErr(null);
      qc.invalidateQueries({ queryKey: ["wiring-status"] });
    },
    onError: (e: any) => setErr(String(e?.message ?? e)),
  });

  const Flag = ({ ok }: { ok: boolean | null | undefined }) =>
    ok ? (
      <CheckCircle2 size={14} className="text-primary" />
    ) : (
      <XCircle size={14} className="text-destructive" />
    );

  return (
    <div className="px-5 space-y-4">
      <Link to="/connections" className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <ArrowLeft size={14} /> zurück
      </Link>

      <h2 className="text-xs uppercase tracking-widest text-muted-foreground">Telegram-Bot</h2>

      <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
        <ol className="text-xs space-y-2 text-muted-foreground list-decimal list-inside">
          <li>@BotFather öffnen, <code>/newbot</code>, Token kopieren.</li>
          <li>
            Token als Secret <code className="text-primary">PIHUB_TELEGRAM_BOT_TOKEN</code> hinterlegen
            (optional zusätzlich <code>PIHUB_TELEGRAM_WEBHOOK_SECRET</code>).
          </li>
          <li>Unten „Webhook setzen" drücken.</li>
          <li>
            Im Chat <code className="text-primary">/link DEIN-LINK-SECRET</code> senden
            (<code>PIHUB_LINK_SECRET</code>). Der Bot antwortet mit der Chat-ID — diese dauerhaft in{" "}
            <code>PIHUB_TELEGRAM_CHAT_IDS</code> eintragen.
          </li>
        </ol>

        <div className="space-y-1.5 text-xs">
          <div className="flex items-center gap-2">
            <Flag ok={tg?.configured} />
            Bot-Token {tg?.botUsername ? <span className="font-mono text-primary">@{tg.botUsername}</span> : "fehlt"}
          </div>
          <div className="flex items-center gap-2">
            <Flag ok={tg?.secretSet} /> Webhook-Secret
          </div>
          <div className="flex items-center gap-2">
            <Flag ok={tg?.webhookOk} /> Webhook aktiv
          </div>
          <div className="flex items-center gap-2">
            <Flag ok={(tg?.chatAllowlist ?? 0) > 0} /> {tg?.chatAllowlist ?? 0} Chat-ID(s) dauerhaft freigegeben
          </div>
          {tg?.webhookInfo && (
            <p className="text-[10px] font-mono text-muted-foreground break-all">{tg.webhookInfo}</p>
          )}
        </div>

        {err && <p className="text-xs text-destructive">{err}</p>}

        <button
          onClick={() => install.mutate()}
          disabled={!tg?.configured || install.isPending}
          className="w-full rounded-lg bg-primary text-primary-foreground py-2 text-xs uppercase tracking-widest disabled:opacity-50"
        >
          {install.isPending ? "..." : "Webhook setzen"}
        </button>
        <p className="text-[10px] font-mono text-muted-foreground break-all">{tg?.webhookUrl}</p>
      </div>

      <div className="rounded-2xl border border-border bg-card/60 p-4 text-[11px] text-muted-foreground leading-relaxed">
        <p className="font-bold text-foreground mb-1">Befehle</p>
        <ul className="space-y-1 list-disc list-inside">
          <li><code>/pump on 10</code> · <code>/pump off</code> · <code>/pump status</code></li>
          <li><code>/status</code> · <code>/price</code></li>
          <li><code>/mqtt pub cmnd/zisterne/POWER ON</code></li>
          <li>Freitext oder Sprachmemo → AI-Assistent mit Tool-Zugriff</li>
        </ul>
      </div>
    </div>
  );
}
