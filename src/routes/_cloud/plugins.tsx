import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  Puzzle,
  Plus,
  Settings2,
  Activity,
  Zap,
  Trash2,
  Save,
  Info,
  ArrowLeft,
} from "lucide-react";
import { listDevices, enqueueCommand } from "@/lib/cloud.functions";

export const Route = createFileRoute("/_cloud/plugins")({
  component: PluginsPage,
});

function PluginsPage() {
  const fetchDevices = useServerFn(listDevices);
  const enqueue = useServerFn(enqueueCommand);
  const qc = useQueryClient();

  const [showAdd, setShowAdd] = useState(false);
  const [selectedPlugin, setSelectedPlugin] = useState<any>(null);

  const { data: devices = [] } = useQuery({
    queryKey: ["devices"],
    queryFn: () => fetchDevices(),
  });

  const plugins = devices.flatMap((d: any) =>
    (d.snapshot?.plugins || []).map((p: any) => ({ ...p, deviceId: d.id, deviceName: d.name })),
  );

  const cmd = useMutation({
    mutationFn: (vars: { deviceId: string; kind: string; payload: any }) =>
      enqueue({ data: { deviceId: vars.deviceId, kind: vars.kind, payload: vars.payload } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["devices"] });
      setSelectedPlugin(null);
      setShowAdd(false);
    },
  });

  const showList = !showAdd && !selectedPlugin;

  return (
    <div className="px-5 space-y-6">
      {showList ? (
        <>
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xs uppercase tracking-widest text-muted-foreground mb-1">
                Plugins
              </h2>
              <p className="text-xs text-muted-foreground">
                Verwalte Automatisierungen auf deinen Geräten.
              </p>
            </div>
            <button
              onClick={() => setShowAdd(true)}
              className="rounded-lg bg-primary text-primary-foreground px-3 py-1.5 text-xs uppercase tracking-widest flex items-center gap-1"
            >
              <Plus size={14} /> Neu
            </button>
          </div>

          <div className="space-y-3">
            {plugins.map((p: any) => (
              <div
                key={`${p.deviceId}-${p.id}`}
                className="rounded-2xl border border-border bg-card p-4 flex items-center gap-4 active:scale-[0.99] transition-transform cursor-pointer"
                onClick={() => setSelectedPlugin(p)}
              >
                <div className="rounded-xl bg-primary/10 p-2.5 text-primary shrink-0">
                  <Puzzle size={20} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-sm truncate">{p.name}</span>
                    {!p.enabled && (
                      <span className="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded uppercase tracking-tighter">
                        Off
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-muted-foreground truncate">
                    {p.deviceName} · {p.kind}
                  </div>
                </div>
                <div className="text-muted-foreground">
                  <Settings2 size={16} />
                </div>
              </div>
            ))}

            {plugins.length === 0 && (
              <div className="rounded-2xl border border-dashed border-border p-8 text-center space-y-3">
                <Puzzle size={32} className="mx-auto text-muted-foreground/40" />
                <p className="text-xs text-muted-foreground">Noch keine Plugins konfiguriert.</p>
              </div>
            )}
          </div>
        </>
      ) : (
        <>
          <button
            onClick={() => {
              setShowAdd(false);
              setSelectedPlugin(null);
            }}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground mb-2"
          >
            <ArrowLeft size={14} /> zurück
          </button>

          {showAdd && (
            <PluginForm
              devices={devices}
              onSave={(p: any) =>
                cmd.mutate({ deviceId: p.deviceId, kind: "plugin_create", payload: p })
              }
              onCancel={() => setShowAdd(false)}
            />
          )}

          {selectedPlugin && (
            <PluginForm
              plugin={selectedPlugin}
              devices={devices}
              onSave={(patch: any) =>
                cmd.mutate({
                  deviceId: selectedPlugin.deviceId,
                  kind: "plugin_update",
                  payload: { id: selectedPlugin.id, patch },
                })
              }
              onDelete={() => {
                if (!confirm("Plugin wirklich löschen?")) return;
                cmd.mutate({
                  deviceId: selectedPlugin.deviceId,
                  kind: "plugin_delete",
                  payload: { id: selectedPlugin.id },
                });
              }}
              onCancel={() => setSelectedPlugin(null)}
            />
          )}
        </>
      )}
    </div>
  );
}

function PluginForm({ plugin, devices, onSave, onCancel, onDelete }: any) {
  const [name, setName] = useState(plugin?.name || "");
  const [deviceId, setDeviceId] = useState(plugin?.deviceId || "");
  const [kind, setKind] = useState(plugin?.kind || "generic");
  const [enabled, setEnabled] = useState(plugin?.enabled ?? true);
  const [commands, setCommands] = useState<any[]>(plugin?.commands || []);

  const addCommand = () => {
    setCommands([
      ...commands,
      {
        id: Math.random().toString(36).slice(2, 9),
        name: "",
        label: "",
        type: "control",
        description: "",
      },
    ]);
  };

  const updateCommand = (id: string, patch: any) => {
    setCommands(commands.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  };

  const removeCommand = (id: string) => {
    setCommands(commands.filter((c) => c.id !== id));
  };

  return (
    <div className="rounded-2xl border border-primary/30 bg-card p-5 space-y-4 shadow-xl">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-primary">
          {plugin ? "Plugin bearbeiten" : "Neues Plugin"}
        </h3>
        {plugin && (
          <button
            onClick={onDelete}
            className="text-destructive hover:bg-destructive/10 p-1.5 rounded-lg transition-colors"
          >
            <Trash2 size={16} />
          </button>
        )}
      </div>

      <div className="space-y-3">
        <div className="space-y-1">
          <label className="text-[10px] uppercase tracking-widest text-muted-foreground ml-1">
            Name
          </label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="z.B. Gartenbewässerung"
            className="w-full rounded-xl bg-background border border-border px-3 py-2 text-sm focus:ring-2 ring-primary/20 outline-none"
          />
        </div>

        {!plugin && (
          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-widest text-muted-foreground ml-1">
              Gerät
            </label>
            <select
              value={deviceId}
              onChange={(e) => setDeviceId(e.target.value)}
              className="w-full rounded-xl bg-background border border-border px-3 py-2 text-sm focus:ring-2 ring-primary/20 outline-none"
            >
              <option value="">Wähle ein Gerät...</option>
              {devices
                .filter((d: any) => d.paired)
                .map((d: any) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
            </select>
          </div>
        )}

        <div className="flex items-center gap-4 pt-1">
          <label className="flex items-center gap-2 text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="rounded border-border text-primary focus:ring-primary/20"
            />
            Aktiviert
          </label>
        </div>

        <div className="space-y-3 pt-2">
          <div className="flex items-center justify-between">
            <label className="text-[10px] uppercase tracking-widest text-muted-foreground ml-1">
              Commands (Control & Monitor)
            </label>
            <button
              onClick={addCommand}
              className="text-[10px] font-bold uppercase tracking-widest text-primary flex items-center gap-1 hover:bg-primary/5 px-2 py-1 rounded"
            >
              <Plus size={12} /> Add
            </button>
          </div>

          <div className="space-y-3">
            {commands.map((c) => (
              <div
                key={c.id}
                className="p-3 rounded-xl border border-border bg-background/50 space-y-2 relative group"
              >
                <button
                  onClick={() => removeCommand(c.id)}
                  className="absolute -top-2 -right-2 bg-background border border-border rounded-full p-1 text-muted-foreground hover:text-destructive shadow-sm opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <Trash2 size={12} />
                </button>

                <div className="grid grid-cols-2 gap-2">
                  <input
                    value={c.name}
                    onChange={(e) => updateCommand(c.id, { name: e.target.value })}
                    placeholder="ID (z.B. water_on)"
                    className="bg-transparent border-b border-border text-xs py-1 focus:border-primary outline-none"
                  />
                  <input
                    value={c.label}
                    onChange={(e) => updateCommand(c.id, { label: e.target.value })}
                    placeholder="Label (z.B. Wasser an)"
                    className="bg-transparent border-b border-border text-xs py-1 focus:border-primary outline-none"
                  />
                </div>

                <div className="flex gap-3">
                  <select
                    value={c.type}
                    onChange={(e) => updateCommand(c.id, { type: e.target.value })}
                    className="bg-transparent text-[10px] uppercase tracking-wider font-bold text-primary outline-none"
                  >
                    <option value="control">Control</option>
                    <option value="monitor">Monitor</option>
                  </select>
                  <input
                    value={c.description}
                    onChange={(e) => updateCommand(c.id, { description: e.target.value })}
                    placeholder="Beschreibung für KI..."
                    className="flex-1 bg-transparent text-[10px] border-b border-transparent focus:border-border outline-none"
                  />
                </div>
              </div>
            ))}
            {commands.length === 0 && (
              <div className="text-[10px] text-muted-foreground text-center py-4 border border-dashed border-border rounded-xl italic">
                Definiere Befehle, die Alexa oder Telegram ausführen können.
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex gap-2 pt-2">
        <button
          onClick={() => {
            const data: any = { name, enabled, commands };
            if (!plugin) {
              data.deviceId = deviceId;
              data.kind = kind;
              data.config = {};
            }
            onSave(data);
          }}
          disabled={!name || (!plugin && !deviceId)}
          className="flex-1 rounded-xl bg-primary text-primary-foreground py-2.5 text-xs font-bold uppercase tracking-widest flex items-center justify-center gap-2 shadow-lg shadow-primary/20 disabled:opacity-50 transition-all active:scale-[0.98]"
        >
          <Save size={14} /> Speichern
        </button>
        <button
          onClick={onCancel}
          className="flex-1 rounded-xl border border-border bg-background py-2.5 text-xs font-bold uppercase tracking-widest transition-all active:scale-[0.98]"
        >
          Abbrechen
        </button>
      </div>
    </div>
  );
}
