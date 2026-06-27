import { createFileRoute, useNavigate, Link, useSearch } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { z } from "zod";

const authSearchSchema = z.object({
  returnTo: z.string().optional(),
  local: z.string().optional(),
  nonce: z.string().optional(),
  hostname: z.string().optional(),
});

export const Route = createFileRoute("/auth")({
  ssr: false,
  validateSearch: (s) => authSearchSchema.parse(s),
  component: AuthPage,
});

function buildPostAuthTarget(search: z.infer<typeof authSearchSchema>): string {
  if (search.returnTo === "pair-callback" && search.local && search.nonce) {
    const params = new URLSearchParams({
      local: search.local,
      nonce: search.nonce,
    });
    if (search.hostname) params.set("hostname", search.hostname);
    return "/pair-callback?" + params.toString();
  }
  return "/devices";
}


function AuthPage() {
  const navigate = useNavigate();
  const search = useSearch({ from: "/auth" });
  const postAuth = buildPostAuthTarget(search);
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin + postAuth },
        });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
      navigate({ to: postAuth });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <h1 className="text-3xl font-mono font-bold text-primary mb-1">PI HUB</h1>
        <p className="text-xs text-muted-foreground uppercase tracking-widest mb-8">
          Cloud Control
        </p>

        <div className="rounded-2xl border border-border bg-card p-6">
          <div className="flex gap-2 mb-6 text-xs uppercase tracking-widest">
            <button
              onClick={() => setMode("signin")}
              className={`flex-1 py-2 rounded-lg ${mode === "signin" ? "bg-primary text-primary-foreground" : "bg-muted"}`}
            >
              Anmelden
            </button>
            <button
              onClick={() => setMode("signup")}
              className={`flex-1 py-2 rounded-lg ${mode === "signup" ? "bg-primary text-primary-foreground" : "bg-muted"}`}
            >
              Registrieren
            </button>
          </div>

          <button
            type="button"
            onClick={async () => {
              setError(null);
              const result = await lovable.auth.signInWithOAuth("google", {
                redirect_uri: window.location.origin + postAuth,
              });
              if (result.error) {
                setError(result.error.message);
                return;
              }
              if (result.redirected) return;
              navigate({ to: postAuth });
            }}
            className="w-full rounded-lg bg-background border border-border py-3 text-sm font-bold uppercase tracking-widest mb-4 hover:bg-muted"
          >
            Mit Google fortfahren
          </button>
          <div className="flex items-center gap-3 mb-4 text-xs text-muted-foreground">
            <div className="flex-1 h-px bg-border" />
            oder
            <div className="flex-1 h-px bg-border" />
          </div>

          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="block text-xs uppercase tracking-widest mb-1 text-muted-foreground">
                E-Mail
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full rounded-lg bg-background border border-border px-3 py-2 font-mono text-sm"
              />
            </div>
            <div>
              <label className="block text-xs uppercase tracking-widest mb-1 text-muted-foreground">
                Passwort
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                className="w-full rounded-lg bg-background border border-border px-3 py-2 font-mono text-sm"
              />
            </div>
            {error && <div className="text-xs text-destructive font-mono">{error}</div>}
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-primary text-primary-foreground py-3 text-sm font-bold uppercase tracking-widest disabled:opacity-50"
            >
              {loading ? "..." : mode === "signin" ? "Einloggen" : "Konto anlegen"}
            </button>
          </form>
        </div>

        <Link
          to="/login"
          className="block text-center text-xs text-muted-foreground mt-6 underline"
        >
          Stattdessen Pi-Local Dashboard (PIN)
        </Link>
      </div>
    </div>
  );
}
