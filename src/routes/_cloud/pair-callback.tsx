// Runs *after* Supabase sign-in on the cloud popup. Mints a one-shot device
// token, stores it keyed by sha256(nonce) — the Pi picks it up by polling.
import { createFileRoute, useSearch } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { mintLocalPairing } from "@/lib/cloud-pairing.functions";

const searchSchema = z.object({
  local: z.string().url().optional(),
  nonce: z.string().min(8),
  hostname: z.string().min(1).max(128).optional(),
});

export const Route = createFileRoute("/_cloud/pair-callback")({
  validateSearch: (s) => searchSchema.parse(s),
  component: PairCallback,
});

function PairCallback() {
  const search = useSearch({ from: "/_cloud/pair-callback" });
  const mint = useServerFn(mintLocalPairing);
  const startedRef = useRef(false);
  const [status, setStatus] = useState<"working" | "ok" | "error">("working");
  const [message, setMessage] = useState("Erzeuge sicheren Geräte-Token …");
  const [name, setName] = useState<string | null>(null);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    const guardKey = `pi-hub-pairing:${search.nonce}`;
    const existingState = window.sessionStorage.getItem(guardKey);
    if (existingState === "running" || existingState === "ok") {
      setMessage("Pairing läuft bereits …\nKehre zum Pi-Dashboard zurück — die Verbindung wird automatisch hergestellt.");
      return;
    }
    window.sessionStorage.setItem(guardKey, "running");

    (async () => {
      try {
        const hostname =
          search.hostname || (search.local ? new URL(search.local).hostname : "pi-hub");
        const res = await mint({ data: { nonce: search.nonce, hostname } });
        if (!res.ok) throw new Error("Pairing fehlgeschlagen");
        setName(res.name);
        setStatus("ok");
        window.sessionStorage.setItem(guardKey, "ok");
        setMessage(
          `✓ ${res.name} verknüpft.\nKehre zum Pi-Dashboard zurück — die Verbindung wird automatisch hergestellt.`,
        );
        // Auto-close popup after a moment so the parent (Pi UI) can pick it up
        setTimeout(() => {
          if (window.opener) {
            window.opener.focus();
            window.close();
            return;
          }
          if (search.local) window.location.assign(search.local);
        }, 2500);
      } catch (e: any) {
        window.sessionStorage.removeItem(guardKey);
        const msg = e?.message || String(e);
        if (msg.includes("duplicate key") || msg.includes("cloud_pairings_nonce_hash_key")) {
          setStatus("ok");
          setMessage(
            "✓ Geräte-Token wurde bereits erzeugt.\nKehre zum Pi-Dashboard zurück — die Verbindung wird automatisch hergestellt.",
          );
          setTimeout(() => {
            if (window.opener) {
              window.opener.focus();
              window.close();
              return;
            }
            if (search.local) window.location.assign(search.local);
          }, 2500);
          return;
        }
        setStatus("error");
        setMessage(msg);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="px-5 py-10 max-w-md mx-auto text-center space-y-4">
      <h2 className="text-xs uppercase tracking-widest text-muted-foreground">
        Cloud-Bridge Pairing
      </h2>
      <div
        className={`rounded-2xl border p-6 ${
          status === "ok"
            ? "border-primary/40 bg-primary/5"
            : status === "error"
              ? "border-destructive/40 bg-destructive/5"
              : "border-border bg-card"
        }`}
      >
        <p className="font-mono text-sm whitespace-pre-line">{message}</p>
        {name && (
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground mt-2">
            Gerät: {name}
          </p>
        )}
        {status === "ok" && search.local && (
          <a
            href={search.local}
            className="inline-flex mt-5 rounded-lg bg-primary px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-primary-foreground"
          >
            Zurück zum Pi
          </a>
        )}
      </div>
    </div>
  );
}
