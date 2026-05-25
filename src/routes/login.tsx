import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Delete } from "lucide-react";
import { verifyPin } from "@/lib/auth.functions";
import { auth } from "@/lib/auth-store";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "del"] as const;

function LoginPage() {
  const navigate = useNavigate();
  const verify = useServerFn(verifyPin);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [trust, setTrust] = useState(true);

  const onKey = async (k: string) => {
    setError(null);
    if (k === "del") {
      setPin((p) => p.slice(0, -1));
      return;
    }
    if (!k) return;
    if (pin.length >= 4) return;
    const next = pin + k;
    setPin(next);
    if (next.length === 4) {
      setBusy(true);
      try {
        const res = await verify({ data: { pin: next, trust } });
        if (res.ok) {
          auth.setToken(res.token);
          navigate({ to: "/overview" });
        } else {
          setError("Invalid PIN");
          setTimeout(() => setPin(""), 400);
        }
      } finally {
        setBusy(false);
      }
    }
  };

  return (
    <main className="min-h-screen bg-background text-foreground flex flex-col items-center justify-center px-6 max-w-md mx-auto">
      <div className="mb-10 text-center">
        <div className="size-16 border-2 border-primary mx-auto mb-5 flex items-center justify-center rotate-45 glow-accent">
          <div className="-rotate-45 font-mono text-primary font-bold tracking-widest">PI</div>
        </div>
        <h1 className="text-[10px] uppercase tracking-[0.4em] text-primary/70 mb-2">
          System Restricted
        </h1>
        <p className="text-sm text-muted-foreground">Enter PIN to access hub</p>
        <p className="text-[10px] text-muted-foreground/50 mt-1 font-mono">
          (demo PIN: 1234)
        </p>
      </div>

      {/* PIN dots */}
      <div
        className={`flex gap-4 mb-10 transition-transform ${error ? "animate-pulse" : ""}`}
        aria-live="polite"
      >
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className={`size-3 rounded-full border-2 transition-all ${
              i < pin.length
                ? "bg-primary border-primary glow-accent"
                : "border-border bg-transparent"
            }`}
          />
        ))}
      </div>

      <div className="grid grid-cols-3 gap-3 w-full max-w-[300px]">
        {KEYS.map((k, i) => {
          if (k === "") return <div key={i} />;
          if (k === "del") {
            return (
              <button
                key={i}
                onClick={() => onKey("del")}
                disabled={busy}
                className="aspect-square rounded-2xl border border-border bg-card/40 flex items-center justify-center text-muted-foreground active:bg-primary/20 active:scale-95 transition-all"
                aria-label="Delete"
              >
                <Delete className="size-5" />
              </button>
            );
          }
          return (
            <button
              key={i}
              onClick={() => onKey(k)}
              disabled={busy}
              className="aspect-square rounded-2xl border border-border bg-card/40 flex items-center justify-center text-xl font-mono active:bg-primary/20 active:text-primary active:scale-95 transition-all"
            >
              {k}
            </button>
          );
        })}
      </div>

      <label className="flex items-center gap-3 mt-8 text-xs text-muted-foreground select-none">
        <input
          type="checkbox"
          checked={trust}
          onChange={(e) => setTrust(e.target.checked)}
          className="size-4 accent-primary"
        />
        <span className="uppercase tracking-widest font-semibold">Trust this device</span>
      </label>

      <div className="h-6 mt-4 text-xs text-status-crit font-mono">{error}</div>
    </main>
  );
}
