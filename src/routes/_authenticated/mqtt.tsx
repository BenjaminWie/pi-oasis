import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { Pause, Play, Trash2, Send, Radio } from "lucide-react";
import { listMqttBrokers, pollMqttMessages, publishMqttMessage } from "@/lib/mqtt/mqtt.functions";
import type { MqttMessage } from "@/lib/core/mock-data";

export const Route = createFileRoute("/_authenticated/mqtt")({
  component: MqttPage,
});

const MAX_MESSAGES = 500;

function MqttPage() {
  const brokersFn = useServerFn(listMqttBrokers);
  const pollFn = useServerFn(pollMqttMessages);
  const pubFn = useServerFn(publishMqttMessage);

  const brokers = useQuery({
    queryKey: ["mqtt-brokers"],
    queryFn: () => brokersFn(),
    refetchInterval: 15000,
  });

  const [brokerId, setBrokerId] = useState<string | null>(null);
  const [topicFilter, setTopicFilter] = useState("#");
  const [paused, setPaused] = useState(false);
  const [messages, setMessages] = useState<MqttMessage[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showPublish, setShowPublish] = useState(false);
  const [pubTopic, setPubTopic] = useState("home/control/light");
  const [pubPayload, setPubPayload] = useState('{"state":"on"}');
  const scrollRef = useRef<HTMLDivElement>(null);

  // pick first broker by default
  useEffect(() => {
    if (!brokerId && brokers.data?.length) setBrokerId(brokers.data[0].id);
  }, [brokers.data, brokerId]);

  // poll for new messages
  useQuery({
    queryKey: ["mqtt-poll", brokerId, topicFilter, paused],
    queryFn: async () => {
      if (!brokerId || paused) return { messages: [] };
      const res = await pollFn({ data: { brokerId, topicFilter } });
      if (res.messages.length) {
        setMessages((prev) => [...res.messages.reverse(), ...prev].slice(0, MAX_MESSAGES));
      }
      return res;
    },
    enabled: !!brokerId && !paused,
    refetchInterval: 2000,
    refetchIntervalInBackground: false,
  });

  const publish = useMutation({
    mutationFn: () =>
      pubFn({ data: { brokerId: brokerId!, topic: pubTopic, payload: pubPayload } }),
    onSuccess: () => setShowPublish(false),
  });

  const activeBroker = brokers.data?.find((b) => b.id === brokerId);

  return (
    <div className="px-4 pt-6 pb-4 flex flex-col h-[calc(100vh-7rem)]">
      <header className="mb-4">
        <div className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground mb-1">
          Broker · MQTT
        </div>
        <div className="flex items-center gap-2">
          <Radio className="size-3.5 text-primary" />
          <span className="font-mono text-xs text-primary/90">
            {activeBroker ? `${activeBroker.name} :${activeBroker.port}` : "no broker detected"}
          </span>
        </div>
      </header>

      {/* broker switcher */}
      {brokers.data && brokers.data.length > 1 && (
        <div className="flex gap-2 mb-3 overflow-x-auto">
          {brokers.data.map((b) => (
            <button
              key={b.id}
              onClick={() => {
                setBrokerId(b.id);
                setMessages([]);
              }}
              className={`shrink-0 px-3 py-1.5 rounded-full text-[10px] font-mono uppercase tracking-widest border ${
                brokerId === b.id
                  ? "bg-primary/15 border-primary/40 text-primary"
                  : "bg-card border-border text-muted-foreground"
              }`}
            >
              {b.name}
            </button>
          ))}
        </div>
      )}

      {/* controls */}
      <div className="flex items-center gap-2 mb-3">
        <input
          value={topicFilter}
          onChange={(e) => setTopicFilter(e.target.value)}
          placeholder="topic filter (# = all)"
          className="flex-1 bg-card border border-border rounded-2xl px-3 py-2 font-mono text-xs text-primary focus:outline-none focus:border-primary/40 placeholder:text-muted-foreground/40"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
        />
        <button
          onClick={() => setPaused((p) => !p)}
          aria-label={paused ? "Resume" : "Pause"}
          className={`size-10 rounded-2xl grid place-items-center border ${
            paused
              ? "bg-status-warn/15 border-status-warn/40 text-status-warn"
              : "bg-card border-border text-muted-foreground"
          }`}
        >
          {paused ? <Play className="size-4" /> : <Pause className="size-4" />}
        </button>
        <button
          onClick={() => setMessages([])}
          aria-label="Clear"
          className="size-10 rounded-2xl grid place-items-center bg-card border border-border text-muted-foreground"
        >
          <Trash2 className="size-4" />
        </button>
      </div>

      <div className="flex items-center justify-between mb-2 px-1">
        <span className="text-[10px] font-bold uppercase tracking-[0.3em] text-muted-foreground">
          Live Stream · {messages.length}
        </span>
        <button
          onClick={() => setShowPublish((s) => !s)}
          className="text-[10px] font-mono uppercase tracking-widest text-primary bg-primary/10 px-2 py-1 rounded-md"
        >
          {showPublish ? "Cancel" : "Publish"}
        </button>
      </div>

      {showPublish && (
        <div className="bg-card border border-primary/30 rounded-2xl p-3 mb-3 space-y-2">
          <input
            value={pubTopic}
            onChange={(e) => setPubTopic(e.target.value)}
            placeholder="topic"
            className="w-full bg-black/30 border border-border rounded-xl px-3 py-2 font-mono text-xs text-primary"
          />
          <textarea
            value={pubPayload}
            onChange={(e) => setPubPayload(e.target.value)}
            placeholder="payload"
            rows={2}
            className="w-full bg-black/30 border border-border rounded-xl px-3 py-2 font-mono text-xs text-primary resize-none"
          />
          <button
            onClick={() => publish.mutate()}
            disabled={!brokerId || publish.isPending}
            className="w-full bg-primary text-primary-foreground rounded-xl py-2 font-mono text-xs uppercase tracking-widest flex items-center justify-center gap-2 active:scale-[0.98] disabled:opacity-50"
          >
            <Send className="size-3.5" /> Send
          </button>
        </div>
      )}

      <div
        ref={scrollRef}
        className="flex-1 bg-black/80 border border-border rounded-2xl overflow-auto font-mono text-[11px]"
      >
        {messages.length === 0 && (
          <div className="text-muted-foreground/60 p-6 text-center text-xs">
            {paused ? "paused — tap ▶ to resume" : "waiting for messages…"}
          </div>
        )}
        {messages.map((m) => {
          const isOpen = expanded === m.id;
          let pretty = m.payload;
          try {
            pretty = JSON.stringify(JSON.parse(m.payload), null, 2);
          } catch {
            /* not json */
          }
          return (
            <button
              key={m.id}
              onClick={() => setExpanded(isOpen ? null : m.id)}
              className="w-full text-left px-3 py-2 border-b border-border/40 hover:bg-white/5 active:bg-white/10"
            >
              <div className="flex items-baseline gap-2">
                <span className="text-muted-foreground/60 shrink-0">
                  {new Date(m.ts).toLocaleTimeString([], { hour12: false })}
                </span>
                <span className="text-primary truncate">{m.topic}</span>
              </div>
              <div
                className={`text-status-ok/80 mt-1 ${isOpen ? "whitespace-pre-wrap" : "truncate"}`}
              >
                {isOpen ? pretty : m.payload}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
