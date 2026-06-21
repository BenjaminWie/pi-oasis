// Cloud-side landing page that runs *after* Supabase sign-in. Mints a
// device+token for the user's home Pi and POSTs the credentials back to
// the Pi-local install endpoint. The nonce travels through the URL so a
// third party can't trigger an install without holding a fresh Pi-issued
// nonce.
import { createFileRoute, useSearch } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { z } from "zod";
import { mintLocalPairing } from "@/lib/cloud-pairing.functions";

const searchSchema = z.object({
  local: z.string().url(),
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
  const [status, setStatus] = useState<"working" | "ok" | "error">("working");
  const [message, setMessage] = useState("Generiere Geräte-Token …");
  const [name, setName] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const hostname = search.hostname || new URL(search.local).hostname;
        setMessage("Generiere Geräte-Token …");
        const minted = await mint({ data: { hostname } });

        setMessage("Sende Token an deinen Pi …");
        const cloudUrl = window.location.origin;
        const res = await fetch(search.local.replace(/\/+$/, "") + "/api/public/cloud-bridge/install", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            nonce: search.nonce,
            cloudUrl,
            deviceId: minted.deviceId,
            deviceToken: minted.deviceToken,
            name: minted.name,
          }),
        });
        if (!res.ok) {
          const txt = await res.text().catch(() => "");
          throw new Error(`Install fehlgeschlagen (${res.status}): ${txt}`);
        }
        const j = (await res.json()) as { name: string };
        setName(j.name);
        setStatus("ok");
        setMessage(`✓ Verbunden als ${j.name}`);
        // optional: close popup window after 2s
        setTimeout(() => {
          if (window.opener) window.close();
        }, 2000);
      } catch (e: any) {
        setStatus("error");
        setMessage(e.message || String(e));
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
        <p className="font-mono text-sm">{message}</p>
        {name && (
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground mt-2">
            Gerät: {name}
          </p>
        )}
      </div>
      {status === "error" && (
        <p className="text-xs text-muted-foreground">
          Tipp: Stell sicher, dass du im selben WLAN wie der Pi bist und die URL
          erreichbar ist: <code className="text-primary">{search.local}</code>
        </p>
      )}
    </div>
  );
}
