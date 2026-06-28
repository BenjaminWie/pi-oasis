import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { listDevices, createDevice } from "@/lib/cloud.functions";
import { Plus, Cpu, HardDrive, Thermometer } from "lucide-react";

export const Route = createFileRoute("/_cloud/devices/")({
  component: DevicesIndexPage,
});

function DevicesIndexPage() {
  const fetchDevices = useServerFn(listDevices);
  const create = useServerFn(createDevice);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");

  const { data: devices = [], isLoading } = useQuery({
    queryKey: ["devices"],
    queryFn: () => fetchDevices(),
    refetchInterval: 5000,
    refetchIntervalInBackground: false,
  });

  const createMutation = useMutation({
    mutationFn: () => create({ data: { name } }),
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ["devices"] });
      setShowForm(false);
      setName("");
      navigate({ to: "/devices/$id", params: { id: d.id } });
    },
  });

  return (
    <div className="px-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xs uppercase tracking-widest text-muted-foreground">
          Registrierte Geräte
        </h2>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="rounded-lg bg-primary text-primary-foreground px-3 py-1.5 text-xs uppercase tracking-widest flex items-center gap-1"
        >
          <Plus size={14} /> Gerät
        </button>
      </div>

      {showForm && (
        <div className="rounded-2xl border border-border bg-card p-4 mb-4 space-y-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name z.B. wohnzimmer-pi"
            className="w-full rounded-lg bg-background border border-border px-3 py-2 font-mono text-sm"
          />
          <button
            onClick={() => createMutation.mutate()}
            disabled={!name || createMutation.isPending}
            className="w-full rounded-lg bg-primary text-primary-foreground py-2 text-xs uppercase tracking-widest disabled:opacity-50"
          >
            Pairing-Code generieren
          </button>
        </div>
      )}

      {isLoading && <p className="text-xs text-muted-foreground">Lade...</p>}

      <div className="space-y-3">
        {devices.map((d: any) => {
          const online = d.lastSeenAt && Date.now() - new Date(d.lastSeenAt).getTime() < 120_000;
          const snap = d.snapshot || {};
          return (
            <Link
              key={d.id}
              to="/devices/$id"
              params={{ id: d.id }}
              className="block rounded-2xl border border-border bg-card p-4"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span
                    className={`h-2 w-2 rounded-full ${online ? "bg-primary" : "bg-muted-foreground"}`}
                  />
                  <span className="font-mono font-bold">{d.name}</span>
                </div>
                <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                  {d.paired ? (online ? "Online" : "Offline") : "Unpaired"}
                </span>
              </div>
              {d.paired && d.snapshot && (
                <div className="grid grid-cols-3 gap-2 text-[10px] text-muted-foreground">
                  <Stat icon={Cpu} label="CPU" value={fmt(snap.cpu, "%")} />
                  <Stat icon={HardDrive} label="RAM" value={fmt(snap.ram, "%")} />
                  <Stat icon={Thermometer} label="Temp" value={fmt(snap.temp, "°")} />
                </div>
              )}
              {!d.paired && d.pairing && (
                <div className="text-[10px] text-primary font-mono">CODE: {d.pairing.code}</div>
              )}
            </Link>
          );
        })}
        {devices.length === 0 && !isLoading && (
          <p className="text-xs text-muted-foreground text-center py-8">
            Noch keine Geräte. Erstes Gerät anlegen.
          </p>
        )}
      </div>
    </div>
  );
}

function Stat({ icon: Icon, label, value }: any) {
  return (
    <div className="flex items-center gap-1">
      <Icon size={12} />
      <span>{label}</span>
      <span className="ml-auto font-mono text-foreground">{value}</span>
    </div>
  );
}

function fmt(v: any, unit: string) {
  if (v == null) return "—";
  return Math.round(Number(v)) + unit;
}
