import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Check } from "lucide-react";
import { listEndpointsFn, saveEndpointConfigFn } from "@/lib/registry.functions";

export const Route = createFileRoute("/_authenticated/tuning")({
  head: () => ({
    meta: [
      { title: "Feintuning — Pi Control" },
      {
        name: "description",
        content:
          "Pro Endpunkt Name, Einheit, Grenzwerte und Freigaben für Alexa, Telegram und Steuerung festlegen. Wird lokal auf dem Pi gespeichert.",
      },
      { property: "og:title", content: "Feintuning — Pi Control" },
      {
        property: "og:description",
        content: "Endpunkte benennen, begrenzen und für Sprachsteuerung freigeben.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TuningPage,
});

type Ep = {
  id: string;
  label?: string;
  kind: string;
  unit?: string;
  min?: number;
  max?: number;
  voice: boolean;
  control: boolean;
  config: { hidden?: boolean };
};

function TuningPage() {
  const listFn = useServerFn(listEndpointsFn);
  const saveFn = useServerFn(saveEndpointConfigFn);
  const qc = useQueryClient();
  const [saved, setSaved] = useState<string | null>(null);

  const q = useQuery({ queryKey: ["endpoints"], queryFn: () => listFn() });

  const save = useMutation({
    mutationFn: (v: Record<string, unknown>) => saveFn({ data: v as never }),
    onSuccess: (_r, v) => {
      setSaved(String((v as { id: string }).id));
      qc.invalidateQueries({ queryKey: ["endpoints"] });
      setTimeout(() => setSaved(null), 1500);
    },
  });

  const eps = (q.data?.endpoints ?? []) as Ep[];

  return (
    <div className="px-5 pt-6 space-y-4">
      <header>
        <h1 className="text-lg font-semibold tracking-tight">Feintuning</h1>
        <p className="text-[11px] text-muted-foreground">
          Nur diese Einstellungen werden gespeichert — die Endpunkte selbst kommen aus Node-RED.
        </p>
      </header>

      {eps.length === 0 && (
        <p className="text-xs text-muted-foreground">
          Noch keine Endpunkte gemeldet. Starte den Node-RED-Flow, dann erscheinen sie hier.
        </p>
      )}

      {eps.map((e) => (
        <Card key={e.id} ep={e} saved={saved === e.id} onSave={(patch) => save.mutate(patch)} />
      ))}
    </div>
  );
}

function Card({
  ep,
  saved,
  onSave,
}: {
  ep: Ep;
  saved: boolean;
  onSave: (patch: Record<string, unknown>) => void;
}) {
  const [label, setLabel] = useState(ep.label ?? "");
  const [unit, setUnit] = useState(ep.unit ?? "");
  const [min, setMin] = useState(ep.min == null ? "" : String(ep.min));
  const [max, setMax] = useState(ep.max == null ? "" : String(ep.max));
  const [voice, setVoice] = useState(ep.voice);
  const [control, setControl] = useState(ep.control);
  const [hidden, setHidden] = useState(Boolean(ep.config?.hidden));

  const numOrNull = (s: string) => (s.trim() === "" ? null : Number(s));

  return (
    <section className="rounded-2xl border border-border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-mono text-muted-foreground truncate">{ep.id}</p>
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
          {ep.kind}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Field label="Anzeigename">
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="w-full rounded-xl bg-muted px-3 py-2 text-xs"
          />
        </Field>
        <Field label="Einheit">
          <input
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
            className="w-full rounded-xl bg-muted px-3 py-2 text-xs"
          />
        </Field>
        <Field label="Minimum">
          <input
            type="number"
            value={min}
            onChange={(e) => setMin(e.target.value)}
            className="w-full rounded-xl bg-muted px-3 py-2 text-xs tabular-nums"
          />
        </Field>
        <Field label="Maximum">
          <input
            type="number"
            value={max}
            onChange={(e) => setMax(e.target.value)}
            className="w-full rounded-xl bg-muted px-3 py-2 text-xs tabular-nums"
          />
        </Field>
      </div>

      <div className="space-y-1.5">
        <Toggle
          checked={voice}
          onChange={setVoice}
          label="Für Alexa, Telegram und Assistent sichtbar"
        />
        <Toggle
          checked={control}
          onChange={setControl}
          label="Darf geschaltet werden"
          disabled={ep.kind === "read"}
        />
        <Toggle checked={hidden} onChange={setHidden} label="In der Steuerung ausblenden" />
      </div>

      <button
        onClick={() =>
          onSave({
            id: ep.id,
            label: label || undefined,
            unit: unit || undefined,
            min: numOrNull(min),
            max: numOrNull(max),
            voice,
            control,
            hidden,
          })
        }
        className="inline-flex items-center gap-1 rounded-xl bg-primary/15 text-primary px-3 py-1.5 text-[11px] font-semibold uppercase tracking-widest"
      >
        {saved ? <Check size={12} /> : null} speichern
      </button>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[10px] uppercase tracking-widest text-muted-foreground mb-1">
        {label}
      </span>
      {children}
    </label>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <label className={`flex items-center gap-2 text-xs ${disabled ? "opacity-50" : ""}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="size-4 accent-current text-primary"
      />
      <span>{label}</span>
    </label>
  );
}
