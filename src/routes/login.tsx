import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Delete } from "lucide-react";
import { toast } from "sonner";
import { verifyPin, changePin, resetPinWithFactoryToken } from "@/lib/auth.functions";
import { auth } from "@/lib/auth-store";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "del"] as const;

function LoginPage() {
  const navigate = useNavigate();
  const verify = useServerFn(verifyPin);
  const changeFn = useServerFn(changePin);
  const resetFn = useServerFn(resetPinWithFactoryToken);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [trust, setTrust] = useState(true);
  const [modal, setModal] = useState<null | "change" | "reset">(null);

  const completeLogin = async (newPin: string) => {
    const res = await verify({ data: { pin: newPin, trust } });
    if (res.ok) {
      auth.setToken(res.token);
      navigate({ to: "/overview" });
    } else {
      setError("PIN gespeichert, aber Login fehlgeschlagen");
    }
  };

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

      <div className="flex gap-6 mt-2 text-[10px] uppercase tracking-[0.3em]">
        <button
          onClick={() => setModal("change")}
          className="text-muted-foreground hover:text-primary transition-colors"
        >
          Change PIN
        </button>
        <span className="text-border">·</span>
        <button
          onClick={() => setModal("reset")}
          className="text-muted-foreground hover:text-primary transition-colors"
        >
          Forgot PIN?
        </button>
      </div>

      {modal === "change" && (
        <ChangePinModal
          onClose={() => setModal(null)}
          submit={async (cur, neu) => {
            // Mint token via current PIN, then change.
            const v = await verify({ data: { pin: cur, trust: false } });
            if (!v.ok) return { ok: false as const, error: "Aktuelle PIN falsch" };
            auth.setToken(v.token);
            const r = await changeFn({ data: { currentPin: cur, newPin: neu } });
            if (!r.ok) return r;
            toast.success("PIN geändert");
            await completeLogin(neu);
            return { ok: true as const };
          }}
        />
      )}
      {modal === "reset" && (
        <ResetPinModal
          onClose={() => setModal(null)}
          submit={async (tok, neu) => {
            const r = await resetFn({ data: { factoryToken: tok, newPin: neu } });
            if (!r.ok) return r;
            toast.success("PIN zurückgesetzt");
            await completeLogin(neu);
            return { ok: true as const };
          }}
        />
      )}
    </main>
  );
}

type SubmitResult = { ok: true } | { ok: false; error?: string };

function ModalShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-card border border-border rounded-3xl p-5 w-full max-w-sm space-y-3"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-xs uppercase tracking-widest text-muted-foreground">{title}</h3>
        {children}
      </div>
    </div>
  );
}

function ChangePinModal({
  onClose,
  submit,
}: {
  onClose: () => void;
  submit: (cur: string, neu: string) => Promise<SubmitResult>;
}) {
  const [cur, setCur] = useState("");
  const [neu, setNeu] = useState("");
  const [confirm, setConfirm] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async () => {
    setErr(null);
    if (!/^\d{4,8}$/.test(neu)) return setErr("Neue PIN muss 4–8 Ziffern sein");
    if (neu !== confirm) return setErr("PINs stimmen nicht überein");
    setBusy(true);
    try {
      const r = await submit(cur, neu);
      if (!r.ok) setErr(r.error || "Fehler");
      else onClose();
    } catch (e: any) {
      setErr(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell title="Change PIN" onClose={onClose}>
      <input
        value={cur}
        onChange={(e) => setCur(e.target.value)}
        placeholder="Aktuelle PIN"
        type="password"
        inputMode="numeric"
        maxLength={8}
        className="w-full rounded-lg bg-background border border-border px-3 py-2 font-mono text-sm"
      />
      <input
        value={neu}
        onChange={(e) => setNeu(e.target.value)}
        placeholder="Neue PIN (4–8 Ziffern)"
        type="password"
        inputMode="numeric"
        maxLength={8}
        className="w-full rounded-lg bg-background border border-border px-3 py-2 font-mono text-sm"
      />
      <input
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        placeholder="Neue PIN bestätigen"
        type="password"
        inputMode="numeric"
        maxLength={8}
        className="w-full rounded-lg bg-background border border-border px-3 py-2 font-mono text-sm"
      />
      {err && <p className="text-xs text-destructive">{err}</p>}
      <button
        onClick={onSubmit}
        disabled={busy}
        className="w-full bg-primary text-primary-foreground py-2 rounded-lg text-xs font-bold uppercase tracking-widest disabled:opacity-40"
      >
        {busy ? "…" : "Speichern & Login"}
      </button>
    </ModalShell>
  );
}

function ResetPinModal({
  onClose,
  submit,
}: {
  onClose: () => void;
  submit: (tok: string, neu: string) => Promise<SubmitResult>;
}) {
  const [tok, setTok] = useState("");
  const [neu, setNeu] = useState("");
  const [confirm, setConfirm] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async () => {
    setErr(null);
    if (tok.length < 16) return setErr("Factory-Token zu kurz");
    if (!/^\d{4,8}$/.test(neu)) return setErr("Neue PIN muss 4–8 Ziffern sein");
    if (neu !== confirm) return setErr("PINs stimmen nicht überein");
    setBusy(true);
    try {
      const r = await submit(tok, neu);
      if (!r.ok) setErr(r.error || "Fehler");
      else onClose();
    } catch (e: any) {
      setErr(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell title="Reset PIN" onClose={onClose}>
      <p className="text-xs text-muted-foreground">
        Factory-Token findest du auf dem Pi unter <code>~/.pi-hub/state.json</code> oder
        im Output von <code>./scripts/install.sh</code>.
      </p>
      <input
        value={tok}
        onChange={(e) => setTok(e.target.value)}
        placeholder="Factory-Token (32 hex)"
        className="w-full rounded-lg bg-background border border-border px-3 py-2 font-mono text-xs"
      />
      <input
        value={neu}
        onChange={(e) => setNeu(e.target.value)}
        placeholder="Neue PIN (4–8 Ziffern)"
        type="password"
        inputMode="numeric"
        maxLength={8}
        className="w-full rounded-lg bg-background border border-border px-3 py-2 font-mono text-sm"
      />
      <input
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        placeholder="Neue PIN bestätigen"
        type="password"
        inputMode="numeric"
        maxLength={8}
        className="w-full rounded-lg bg-background border border-border px-3 py-2 font-mono text-sm"
      />
      {err && <p className="text-xs text-destructive">{err}</p>}
      <button
        onClick={onSubmit}
        disabled={busy}
        className="w-full bg-primary text-primary-foreground py-2 rounded-lg text-xs font-bold uppercase tracking-widest disabled:opacity-40"
      >
        {busy ? "…" : "Zurücksetzen & Login"}
      </button>
    </ModalShell>
  );
}
