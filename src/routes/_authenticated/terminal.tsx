import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { Mic, Send, MicOff } from "lucide-react";
import { runTerminalCommand } from "@/lib/terminal.functions";

export const Route = createFileRoute("/_authenticated/terminal")({
  component: TerminalPage,
});

type SR = {
  start: () => void;
  stop: () => void;
  abort: () => void;
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: any) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: any) => void) | null;
};

declare global {
  interface Window {
    SpeechRecognition?: { new (): SR };
    webkitSpeechRecognition?: { new (): SR };
  }
}

interface Line {
  who: "user" | "sys";
  text: string;
}

function TerminalPage() {
  const run = useServerFn(runTerminalCommand);
  const [lines, setLines] = useState<Line[]>([
    { who: "sys", text: "pi-hub shell · allow-listed commands" },
    { who: "sys", text: 'type "help" or tap the mic to speak · prefix with "gemini" for AI' },
  ]);
  const [input, setInput] = useState("");
  const [listening, setListening] = useState(false);
  const [sttSupported, setSttSupported] = useState(true);
  const [busy, setBusy] = useState(false);
  const recRef = useRef<SR | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const Ctor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Ctor) {
      setSttSupported(false);
      return;
    }
    const r = new Ctor();
    r.continuous = false;
    r.interimResults = true;
    r.lang = "en-US";
    r.onresult = (e: any) => {
      let txt = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        txt += e.results[i][0].transcript;
      }
      setInput(txt);
    };
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    recRef.current = r;
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [lines]);

  const submit = async (raw?: string) => {
    const value = (raw ?? input).trim();
    if (!value) return;
    setInput("");
    if (value === "clear") {
      setLines([]);
      return;
    }
    setLines((l) => [...l, { who: "user", text: value }]);
    setBusy(true);
    try {
      const res = await run({ data: { cmd: value } });
      setLines((l) => [...l, { who: "sys", text: res.output }]);
    } catch (e: any) {
      setLines((l) => [...l, { who: "sys", text: `error: ${e.message || e}` }]);
    } finally {
      setBusy(false);
    }
  };

  const toggleMic = () => {
    if (!recRef.current) return;
    if (listening) {
      recRef.current.stop();
      return;
    }
    setInput("");
    setListening(true);
    try {
      recRef.current.start();
    } catch {
      setListening(false);
    }
  };

  const sendAsGemini = () => {
    if (!input.trim()) return;
    const v = input.trim().startsWith("gemini") ? input : `gemini ${input}`;
    submit(v);
  };

  return (
    <div className="px-4 pt-6 flex flex-col h-[calc(100vh-7rem)]">
      <header className="mb-4">
        <div className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground mb-1">
          Shell · allow-listed
        </div>
        <div className="flex items-center gap-2">
          <div
            className={`size-2 rounded-full ${busy ? "bg-status-warn animate-pulse" : "bg-status-ok animate-pulse"}`}
          />
          <span className="font-mono text-xs text-status-ok/90">{busy ? "running…" : "ready"}</span>
        </div>
      </header>

      <div
        ref={scrollRef}
        className="flex-1 bg-black/80 p-4 font-mono text-[11px] leading-relaxed rounded-2xl border border-border overflow-auto"
      >
        {lines.map((l, i) => (
          <div
            key={i}
            className={l.who === "user" ? "text-primary" : "text-status-ok/80 whitespace-pre-wrap"}
          >
            {l.who === "user" ? `pi@hub:~$ ${l.text}` : l.text}
          </div>
        ))}
        {listening && <div className="text-status-warn italic mt-2">● listening… speak now</div>}
      </div>

      <div className="mt-3 flex items-center gap-2 bg-card/80 backdrop-blur-md border border-border p-2 rounded-3xl">
        <div className="flex-1 relative">
          <div className="absolute left-4 top-1/2 -translate-y-1/2 text-primary font-mono text-xs opacity-50 pointer-events-none">
            $
          </div>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
            placeholder="RUN COMMAND…"
            disabled={busy}
            className="w-full bg-white/5 border border-border rounded-2xl pl-10 pr-3 py-3 font-mono text-xs text-primary focus:outline-none focus:border-primary/30 placeholder:text-muted-foreground/40 disabled:opacity-50"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
        </div>
        <button
          onClick={toggleMic}
          disabled={!sttSupported || busy}
          aria-label={listening ? "Stop listening" : "Start voice input"}
          className={`size-12 shrink-0 rounded-2xl flex items-center justify-center border transition-all ${
            listening
              ? "bg-status-crit/20 border-status-crit/40 text-status-crit animate-pulse"
              : sttSupported
                ? "bg-primary/15 border-primary/40 text-primary glow-accent"
                : "bg-white/5 border-border text-muted-foreground opacity-40"
          }`}
        >
          {listening ? <MicOff className="size-5" /> : <Mic className="size-5" />}
        </button>
        <button
          onClick={sendAsGemini}
          disabled={busy}
          aria-label="Send to gemini"
          className="size-12 shrink-0 rounded-2xl flex items-center justify-center bg-primary text-primary-foreground active:scale-95 transition-transform disabled:opacity-50"
        >
          <Send className="size-5" />
        </button>
      </div>
      {!sttSupported && (
        <p className="text-[10px] text-muted-foreground/60 mt-2 text-center">
          Voice input not supported on this browser. Use Chrome on Android or Safari on iOS.
        </p>
      )}
    </div>
  );
}
