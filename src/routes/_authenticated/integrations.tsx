// Node-RED setup for Pi Control: download the personalized flow, import it,
// hit Deploy. Everything else (URLs, token, broker) is already baked in.
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Download, Cable, Activity, CheckCircle2, XCircle } from "lucide-react";
import {
  getIntegrationsInfo,
  getPersonalizedFlow,
  getIntegrationHealth,
} from "@/lib/integrations.functions";

export const Route = createFileRoute("/_authenticated/integrations")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Node-RED — Pi Control" },
      {
        name: "description",
        content:
          "Personalisierten Node-RED-Flow herunterladen: Endpunkte anmelden, Werte streamen, Kommandos empfangen.",
      },
      { property: "og:title", content: "Node-RED — Pi Control" },
      { property: "og:description", content: "Flow herunterladen, importieren, deployen." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: IntegrationsPage,
});

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="bg-card border border-border rounded-3xl p-5 space-y-2">
      <h3 className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
        {icon} {title}
      </h3>
      {children}
    </section>
  );
}

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1">
      <span className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</span>
      <span className="text-[11px] font-mono break-all text-right">{value ?? "—"}</span>
    </div>
  );
}

function IntegrationsPage() {
  const infoFn = useServerFn(getIntegrationsInfo);
  const flowFn = useServerFn(getPersonalizedFlow);
  const healthFn = useServerFn(getIntegrationHealth);
  const [msg, setMsg] = useState<string | null>(null);

  const { data: info } = useQuery({ queryKey: ["integrations-info"], queryFn: () => infoFn() });
  const { data: health } = useQuery({
    queryKey: ["integration-health"],
    queryFn: () => healthFn(),
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });

  const download = async () => {
    setMsg("Flow wird gebaut…");
    const res = await flowFn();
    if (!res.json) {
      setMsg(`Fehler: ${res.error}`);
      return;
    }
    const blob = new Blob([res.json], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "pi-control-flow.json";
    a.click();
    URL.revokeObjectURL(a.href);
    setMsg("Heruntergeladen — in Node-RED importieren und Deploy drücken.");
  };

  return (
    <div className="px-4 pb-28 space-y-4">
      <h1 className="text-lg font-semibold px-1">Node-RED</h1>

      <Section title="Flow" icon={<Cable className="size-3" />}>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Der Beispiel-Flow bringt Pumpe, Bewässerung, Nachtruhe, PV-Überschuss, Strompreis,
          Regen-Sperre und Strategie schon mit — plus eine Regel, die alle 5 Minuten entscheidet.
          Herunterladen, in Node-RED importieren, Deploy. Die Endpunkte erscheinen dann von selbst
          unter Steuerung, Feintuning und Debug.
        </p>
        <ol className="mt-2 space-y-1 text-[11px] text-muted-foreground list-decimal list-inside">
          <li>Flow herunterladen und in Node-RED importieren</li>
          <li>
            Im Tab „Pi Control" unter Bearbeiten → Umgebungsvariablen deine MQTT-Themen prüfen
            (Pumpe, Leistung, PV, Temperatur, Regen, Preis)
          </li>
          <li>Im Node „Katalog (hier anpassen)" ergänzen, was dein Haus noch kann</li>
          <li>Deploy — danach in Debug den Sprachtest für Alexa oder Telegram ausprobieren</li>
        </ol>
        <button
          onClick={download}
          className="w-full mt-2 py-3 text-[10px] font-bold uppercase tracking-widest bg-primary text-primary-foreground rounded-2xl active:scale-95 transition-transform flex items-center justify-center gap-2"
        >
          <Download className="size-3" /> Personalisierten Flow herunterladen
        </button>
        {msg && <p className="text-[11px] text-center font-mono text-muted-foreground">{msg}</p>}
      </Section>

      <Section title="Lokale Endpunkte" icon={<Cable className="size-3" />}>
        <Row label="Basis" value={info?.local.baseUrl ?? null} />
        <Row label="Announce" value={info?.local.announceUrl ?? null} />
        <Row label="Werte" value={info?.local.liveUrl ?? null} />
        <Row label="Trace" value={info?.local.traceUrl ?? null} />
        <Row
          label="Token"
          value={info?.local.ingestTokenPresent ? `${info.local.ingestTokenPrefix}…` : "nicht gesetzt"}
        />
      </Section>

      <Section title="Gesundheit (24h)" icon={<Activity className="size-3" />}>
        {(health?.routes ?? []).length === 0 ? (
          <p className="text-xs text-muted-foreground">Noch keine Aufrufe protokolliert.</p>
        ) : (
          health!.routes.map((r) => (
            <div key={r.route} className="flex items-center gap-2 py-1">
              {r.ok ? (
                <CheckCircle2 className="size-3 text-primary shrink-0" />
              ) : (
                <XCircle className="size-3 text-destructive shrink-0" />
              )}
              <span className="text-[11px] font-mono truncate">{r.route}</span>
              <span className="ml-auto text-[10px] text-muted-foreground">
                {r.successes}/{r.count}
              </span>
            </div>
          ))
        )}
      </Section>
    </div>
  );
}
