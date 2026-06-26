import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Puzzle, Plus, Droplets, Power, PowerOff } from "lucide-react";
import { listPlugins, createSmartPump } from "@/lib/plugins/plugins.functions";

export const Route = createFileRoute("/_authenticated/plugins")({
  component: PluginsPage,
});

function PluginsPage() {
  const listFn = useServerFn(listPlugins);
  const createFn = useServerFn(createSmartPump);
  const qc = useQueryClient();
  const nav = useNavigate();
  const [showNew, setShowNew] = useState(false);

  const plugins = useQuery({
    queryKey: ["plugins"],
    queryFn: () => listFn(),
    refetchInterval: 10_000,
  });

  const create = useMutation({
    mutationFn: (input: { name: string; lat: number; lon: number }) =>
      createFn({
        data: {
          name: input.name,
          config: {
            cmndTopic: "cmnd/tasmota_pump/POWER",
            statTopic: "stat/tasmota_pump/POWER",
            lat: input.lat,
            lon: input.lon,
            runMinutes: 10,
            maxMinutesPerDay: 30,
            minHoursBetweenRuns: 12,
            simulated: true,
            brokerId: null,
          },
        },
      }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["plugins"] });
      setShowNew(false);
      if (r.plugin) nav({ to: "/plugins/$id", params: { id: r.plugin.id } });
    },
  });

  const list = plugins.data?.plugins ?? [];

  return (
    <div className="px-4 pt-6 pb-24">
      <header className="mb-6 pt-2">
        <div className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground mb-1">
          Automation · Plugins
        </div>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Puzzle className="size-5 text-primary" />
            <h1 className="text-xl font-bold">Plugins</h1>
          </div>
          <button
            onClick={() => setShowNew((s) => !s)}
            className="size-10 rounded-2xl grid place-items-center bg-primary/15 text-primary border border-primary/40"
            aria-label="Add plugin"
          >
            <Plus className="size-4" />
          </button>
        </div>
      </header>

      {showNew && <NewPluginCard onCreate={(d) => create.mutate(d)} busy={create.isPending} />}

      {list.length === 0 && !showNew && (
        <div className="rounded-2xl border border-dashed border-border p-6 text-center">
          <Droplets className="size-6 mx-auto text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground mb-3">
            No plugins yet. Add Smart Pump to start watering on weather signals.
          </p>
          <button
            onClick={() => setShowNew(true)}
            className="text-xs font-mono uppercase tracking-widest bg-primary text-primary-foreground px-4 py-2 rounded-xl"
          >
            + Smart Pump
          </button>
        </div>
      )}

      <ul className="space-y-3">
        {list.map((p) => (
          <li key={p.id}>
            <Link
              to="/plugins/$id"
              params={{ id: p.id }}
              className="block rounded-2xl bg-card border border-border p-4 active:scale-[0.99] transition"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <Droplets className="size-4 text-primary shrink-0" />
                    <span className="font-semibold truncate">{p.name}</span>
                  </div>
                  <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                    {p.kind} · {p.config.simulated ? "SIM" : "LIVE"} · {p.config.runMinutes}m / run
                  </div>
                </div>
                <span
                  className={`text-[10px] font-mono px-2 py-1 rounded-md ${
                    p.enabled ? "bg-status-ok/15 text-status-ok" : "bg-muted text-muted-foreground"
                  }`}
                >
                  {p.enabled ? (
                    <Power className="size-3 inline" />
                  ) : (
                    <PowerOff className="size-3 inline" />
                  )}{" "}
                  {p.enabled ? "ON" : "OFF"}
                </span>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function NewPluginCard({
  onCreate,
  busy,
}: {
  onCreate: (d: { name: string; lat: number; lon: number }) => void;
  busy: boolean;
}) {
  const [name, setName] = useState("Garden Pump");
  const [lat, setLat] = useState("52.52");
  const [lon, setLon] = useState("13.405");
  return (
    <div className="rounded-2xl bg-card border border-primary/30 p-4 mb-4 space-y-3">
      <div className="text-[10px] uppercase tracking-[0.3em] text-primary">New Smart Pump</div>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="name"
        className="w-full bg-black/30 border border-border rounded-xl px-3 py-2 text-sm"
      />
      <div className="grid grid-cols-2 gap-2">
        <input
          value={lat}
          onChange={(e) => setLat(e.target.value)}
          placeholder="lat"
          className="bg-black/30 border border-border rounded-xl px-3 py-2 font-mono text-xs"
        />
        <input
          value={lon}
          onChange={(e) => setLon(e.target.value)}
          placeholder="lon"
          className="bg-black/30 border border-border rounded-xl px-3 py-2 font-mono text-xs"
        />
      </div>
      <p className="text-[10px] text-muted-foreground">
        Starts in <span className="text-primary">simulated</span> mode — no MQTT publish until you
        switch it off in the plugin settings.
      </p>
      <button
        disabled={busy}
        onClick={() => onCreate({ name, lat: Number(lat), lon: Number(lon) })}
        className="w-full bg-primary text-primary-foreground rounded-xl py-2 text-xs font-mono uppercase tracking-widest disabled:opacity-50"
      >
        {busy ? "creating…" : "Create"}
      </button>
    </div>
  );
}
