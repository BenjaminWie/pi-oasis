import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { LogOut, Smartphone, Cpu, Shield, Cloud, KeyRound, RefreshCw } from "lucide-react";
import { auth } from "@/lib/auth-store";
import { changePin, resetPinWithFactoryToken } from "@/lib/auth.functions";
import {
  getHostInfo,
  revokeTrustedDevices,
  getFactoryTokenForDisplay,
} from "@/lib/host-info.functions";
import { createPairingNonce, claimCloudPairing, disconnectCloudBridge } from "@/lib/cloud-pairing.functions";

export const Route = createFileRoute("/_authenticated/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const fetchHost = useServerFn(getHostInfo);
  const revokeFn = useServerFn(revokeTrustedDevices);
  const changeFn = useServerFn(changePin);
  const resetFn = useServerFn(resetPinWithFactoryToken);
  const tokenFn = useServerFn(getFactoryTokenForDisplay);
  const nonceFn = useServerFn(createPairingNonce);
  const claimFn = useServerFn(claimCloudPairing);
  const disconnectFn = useServerFn(disconnectCloudBridge);

  const { data: host } = useQuery({
    queryKey: ["host-info"],
    queryFn: () => fetchHost(),
    refetchInterval: 10_000,
  });

  const [pinMode, setPinMode] = useState<null | "change" | "reset" | "factory">(null);
  const [bridgeStatus, setBridgeStatus] = useState<string | null>(null);

  const revokeMut = useMutation({
    mutationFn: () => revokeFn({}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["host-info"] }),
  });

  const disconnectBridgeMut = useMutation({
    mutationFn: () => disconnectFn({}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["host-info"] }),
  });

  const logout = () => {
    auth.clear();
    navigate({ to: "/login" });
  };

  const startCloudPair = async () => {
    try {
      setBridgeStatus("Erzeuge Nonce …");
      const res = await nonceFn({});
      if (!res.ok) {
        setBridgeStatus(res.error || "Pairing nicht möglich");
        return;
      }
      const cloudUrl =
        (import.meta as any).env?.VITE_PI_HUB_CLOUD_URL ||
        "https://pi-hub.lovable.app";
      const local = window.location.origin;
      const hostname = host?.hostname || window.location.hostname;
      const dest = new URL(cloudUrl + "/auth");
      dest.searchParams.set("returnTo", "pair-callback");
      dest.searchParams.set("local", local);
      dest.searchParams.set("nonce", res.nonce);
      dest.searchParams.set("hostname", hostname);
      window.open(dest.toString(), "pi-hub-pair", "width=480,height=720");
      setBridgeStatus("Warte auf Cloud-Login …");

      // Poll the cloud (via Pi server fn) until the freshly minted pairing shows up
      const nonce = res.nonce;
      const deadline = Date.now() + 5 * 60 * 1000;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 2500));
        const cl = await claimFn({ data: { nonce, cloudUrl } });
        if (cl.ok) {
          setBridgeStatus(`✓ Bridged as ${cl.name}`);
          qc.invalidateQueries({ queryKey: ["host-info"] });
          return;
        }
        if (!cl.ok && "pending" in cl && cl.pending) continue;
        if (!cl.ok && "error" in cl && cl.error) {
          setBridgeStatus(cl.error);
          return;
        }
      }
      setBridgeStatus("Timeout — versuche es nochmal.");
    } catch (e: any) {
      setBridgeStatus(e.message || String(e));
    }
  };

  return (
    <div className="px-4 pt-6 space-y-6">
      <header>
        <div className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground mb-1">
          Configuration
        </div>
        <h1 className="font-mono text-xl">System</h1>
      </header>

      <Section title="Host" icon={<Cpu className="size-4" />}>
        <Row label="Hostname" value={host?.hostname ?? "—"} />
        <Row label="Platform" value={host ? `${host.platform} ${host.release}` : "—"} />
        <Row label="Arch" value={host?.arch ?? "—"} />
        <Row label="Node" value={host?.nodeVersion ?? "—"} />
        <Row label="Runtime" value={host?.isPi ? "Pi (live)" : "preview"} tone={host?.isPi ? "ok" : undefined} />
      </Section>

      <Section title="Cloud bridge" icon={<Cloud className="size-4" />}>
        {host?.cloudBridge?.connected ? (
          <>
            <Row label="Status" value="bridged" tone="ok" />
            <Row label="Gerät" value={host.cloudBridge.deviceName ?? "—"} />
            <Row label="Cloud" value={host.cloudBridge.cloudUrl ?? "—"} />
          </>
        ) : (
          <>
            <p className="text-xs text-muted-foreground mb-3">
              Verbinde diesen Pi mit der Cloud, um aus dem Mobilnetz oder via
              Telegram fernzusteuern. Du meldest dich einmal in der Cloud an,
              das Token wird automatisch übertragen.
            </p>
            <button
              onClick={startCloudPair}
              disabled={!host?.isPi}
              className="w-full py-3 text-[10px] font-bold uppercase tracking-widest bg-primary text-primary-foreground rounded-2xl active:scale-95 transition-transform disabled:opacity-40"
            >
              In Cloud anmelden & Bridge aktivieren
            </button>
            {!host?.isPi && (
              <p className="text-[10px] text-muted-foreground/60 mt-2 text-center">
                Pairing nur auf dem Pi-Runtime verfügbar.
              </p>
            )}
          </>
        )}
      </Section>

      <Section title="Trusted devices" icon={<Smartphone className="size-4" />}>
        {(host?.trustedDevices ?? []).length === 0 ? (
          <p className="text-xs text-muted-foreground">Keine getrusteten Geräte.</p>
        ) : (
          host!.trustedDevices.map((d) => (
            <Row
              key={d.id}
              label={d.label}
              value={new Date(d.lastSeenAt).toLocaleString()}
            />
          ))
        )}
        <button
          onClick={() => revokeMut.mutate()}
          disabled={(host?.trustedDevices ?? []).length === 0 || revokeMut.isPending}
          className="w-full mt-3 py-3 text-[10px] font-bold uppercase tracking-widest border border-border rounded-2xl text-muted-foreground active:scale-95 transition-transform disabled:opacity-40"
        >
          Revoke all
        </button>
      </Section>

      <Section title="Security" icon={<Shield className="size-4" />}>
        <button
          onClick={() => setPinMode("change")}
          className="w-full py-3 text-[10px] font-bold uppercase tracking-widest bg-white/5 border border-border rounded-2xl active:scale-95 transition-transform flex items-center justify-center gap-2"
        >
          <KeyRound className="size-3" /> Change PIN
        </button>
        <button
          onClick={() => setPinMode("reset")}
          className="w-full mt-2 py-3 text-[10px] font-bold uppercase tracking-widest border border-border rounded-2xl text-muted-foreground active:scale-95 transition-transform flex items-center justify-center gap-2"
        >
          <RefreshCw className="size-3" /> Forgot PIN? Reset with factory token
        </button>
        <button
          onClick={() => setPinMode("factory")}
          className="w-full mt-2 py-2 text-[10px] uppercase tracking-widest text-muted-foreground"
        >
          Show factory token
        </button>
      </Section>

      <button
        onClick={logout}
        className="w-full flex items-center justify-center gap-2 py-4 mt-4 bg-status-crit/10 border border-status-crit/30 text-status-crit rounded-2xl text-xs font-bold uppercase tracking-widest active:scale-95 transition-transform"
      >
        <LogOut className="size-4" />
        Disconnect
      </button>

      <p className="text-[10px] text-muted-foreground/50 font-mono text-center pt-4">
        pi-hub · {host?.dashboardVersion ?? "—"}
      </p>

      {pinMode === "change" && (
        <ChangePinModal
          onClose={() => setPinMode(null)}
          submit={async (cur: string, neu: string) => {
            const r = await changeFn({ data: { currentPin: cur, newPin: neu } });
            return r;
          }}
        />
      )}
      {pinMode === "reset" && (
        <ResetPinModal
          onClose={() => setPinMode(null)}
          submit={async (tok: string, neu: string) => {
            const r = await resetFn({ data: { factoryToken: tok, newPin: neu } });
            return r;
          }}
        />
      )}
      {pinMode === "factory" && (
        <FactoryTokenModal
          onClose={() => setPinMode(null)}
          load={async () => (await tokenFn({})).token}
        />
      )}
    </div>
  );
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="flex items-center gap-2 mb-3 px-1">
        <span className="text-primary">{icon}</span>
        <h2 className="text-[10px] font-bold uppercase tracking-[0.3em] text-muted-foreground">
          {title}
        </h2>
      </div>
      <div className="bg-card border border-border rounded-3xl p-4 space-y-2">{children}</div>
    </section>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: "ok" }) {
  return (
    <div className="flex justify-between items-center py-2 border-b border-border/50 last:border-0 gap-2">
      <span className="text-sm text-foreground">{label}</span>
      <span
        className={`font-mono text-xs truncate max-w-[55%] text-right ${tone === "ok" ? "text-status-ok" : "text-muted-foreground"}`}
      >
        {value}
      </span>
    </div>
  );
}

function ModalShell({ title, onClose, children }: any) {
  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
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

function ChangePinModal({ onClose, submit }: any) {
  const [cur, setCur] = useState("");
  const [neu, setNeu] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  return (
    <ModalShell title="Change PIN" onClose={onClose}>
      <input value={cur} onChange={(e) => setCur(e.target.value)} placeholder="Aktuelle PIN" inputMode="numeric" className="w-full rounded-lg bg-background border border-border px-3 py-2 font-mono text-sm" />
      <input value={neu} onChange={(e) => setNeu(e.target.value)} placeholder="Neue PIN (4–8 Ziffern)" inputMode="numeric" className="w-full rounded-lg bg-background border border-border px-3 py-2 font-mono text-sm" />
      {err && <p className="text-xs text-destructive">{err}</p>}
      {ok && <p className="text-xs text-status-ok">PIN geändert.</p>}
      <button
        onClick={async () => {
          setErr(null);
          const r = await submit(cur, neu);
          if (r.ok) {
            setOk(true);
            setTimeout(onClose, 800);
          } else setErr(r.error);
        }}
        className="w-full bg-primary text-primary-foreground py-2 rounded-lg text-xs font-bold uppercase tracking-widest"
      >
        Speichern
      </button>
    </ModalShell>
  );
}

function ResetPinModal({ onClose, submit }: any) {
  const [tok, setTok] = useState("");
  const [neu, setNeu] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  return (
    <ModalShell title="Reset PIN" onClose={onClose}>
      <p className="text-xs text-muted-foreground">
        Factory-Token findest du auf dem Pi unter <code>~/.pi-hub/state.json</code>{" "}
        oder im Output von <code>./scripts/install.sh</code>.
      </p>
      <input value={tok} onChange={(e) => setTok(e.target.value)} placeholder="Factory-Token (32 hex)" className="w-full rounded-lg bg-background border border-border px-3 py-2 font-mono text-xs" />
      <input value={neu} onChange={(e) => setNeu(e.target.value)} placeholder="Neue PIN (4–8 Ziffern)" inputMode="numeric" className="w-full rounded-lg bg-background border border-border px-3 py-2 font-mono text-sm" />
      {err && <p className="text-xs text-destructive">{err}</p>}
      {ok && <p className="text-xs text-status-ok">PIN zurückgesetzt.</p>}
      <button
        onClick={async () => {
          setErr(null);
          const r = await submit(tok, neu);
          if (r.ok) {
            setOk(true);
            setTimeout(onClose, 800);
          } else setErr(r.error);
        }}
        className="w-full bg-primary text-primary-foreground py-2 rounded-lg text-xs font-bold uppercase tracking-widest"
      >
        Zurücksetzen
      </button>
    </ModalShell>
  );
}

function FactoryTokenModal({ onClose, load }: any) {
  const [tok, setTok] = useState<string | null>(null);
  useEffect(() => {
    load().then(setTok);
  }, []);
  return (
    <ModalShell title="Factory token" onClose={onClose}>
      <p className="text-xs text-muted-foreground">
        Notiere diesen Token offline. Er erlaubt das Zurücksetzen der PIN, wenn
        du sie vergisst.
      </p>
      <div className="bg-background border border-border rounded-lg p-3 font-mono text-xs break-all">
        {tok ?? "lade…"}
      </div>
      <button
        onClick={onClose}
        className="w-full bg-primary text-primary-foreground py-2 rounded-lg text-xs font-bold uppercase tracking-widest"
      >
        OK
      </button>
    </ModalShell>
  );
}
