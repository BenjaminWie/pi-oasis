import { createFileRoute } from "@tanstack/react-router";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useEffect, useMemo, useRef, useState } from "react";
import { Bot, Sparkle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputTextarea,
  PromptInputSubmit,
  PromptInputFooter,
  type PromptInputMessage,
} from "@/components/ai-elements/prompt-input";
import { Shimmer } from "@/components/ai-elements/shimmer";

export const Route = createFileRoute("/_cloud/connections/assistant")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Pi-Hub Assistent — Chat mit deiner Anlage" },
      { name: "description", content: "Sprich mit dem Pi-Hub Assistenten. Fragt Status, plant Wässerung, schaltet die Pumpe." },
      { property: "og:title", content: "Pi-Hub Assistent" },
      { property: "og:description", content: "Natürliche Sprache statt Slash-Commands. Nutzt dieselben Tools wie MCP, Telegram und Alexa." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AssistantPage,
});

function AssistantPage() {
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setToken(data.session?.access_token ?? null);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setToken(session?.access_token ?? null);
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        headers: () => (token ? { Authorization: `Bearer ${token}` } : ({} as Record<string, string>)),
      }),
    [token],
  );

  const { messages, sendMessage, status, error } = useChat({
    transport,
    messages: [] as UIMessage[],
  });
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, [status]);

  const busy = status === "submitted" || status === "streaming";

  const handleSubmit = (msg: PromptInputMessage) => {
    const text = msg.text?.trim();
    if (!text || busy) return;
    void sendMessage({ text });
  };

  return (
    <div className="px-5 space-y-4 h-[calc(100vh-140px)] flex flex-col">
      <div>
        <h2 className="text-xs uppercase tracking-widest text-muted-foreground mb-1">
          Assistent
        </h2>
        <p className="text-xs text-muted-foreground">
          Sprich frei mit deiner Anlage. Der Assistent nutzt dieselben Tools wie MCP, Telegram und Alexa.
        </p>
      </div>

      <div className="flex-1 min-h-0 rounded-2xl border border-border bg-card overflow-hidden flex flex-col">
        <Conversation className="flex-1">
          <ConversationContent>
            {messages.length === 0 ? (
              <ConversationEmptyState
                icon={<Bot className="size-8 text-primary" />}
                title="Frag mich alles"
                description={
                  ready
                    ? 'Z.B. "Wie ist der Status?", "Pumpe 10 Minuten an", "Wie teuer ist Strom gerade?"'
                    : "Lade Session…"
                }
              />
            ) : (
              messages.map((m) => {
                const text = m.parts
                  .map((p) => (p.type === "text" ? p.text : ""))
                  .join("");
                const toolParts = m.parts.filter((p) => p.type.startsWith("tool-"));
                return (
                  <Message key={m.id} from={m.role === "user" ? "user" : "assistant"}>
                    <MessageContent className={m.role === "assistant" ? "bg-transparent p-0" : undefined}>
                      {m.role === "assistant" ? (
                        <MessageResponse>{text}</MessageResponse>
                      ) : (
                        <div className="whitespace-pre-wrap">{text}</div>
                      )}
                      {toolParts.length > 0 && (
                        <div className="mt-2 text-[10px] uppercase tracking-widest text-muted-foreground flex items-center gap-1">
                          <Sparkle className="size-3" />
                          {toolParts.length} Tool{toolParts.length > 1 ? "s" : ""} ausgeführt
                        </div>
                      )}
                    </MessageContent>
                  </Message>
                );
              })
            )}
            {status === "submitted" && (
              <Message from="assistant">
                <MessageContent className="bg-transparent p-0">
                  <Shimmer>Denke nach…</Shimmer>
                </MessageContent>
              </Message>
            )}
            {error && (
              <div className="text-xs text-destructive px-4 py-2">
                {String(error.message || error)}
              </div>
            )}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>

        <div className="border-t border-border p-3">
          <PromptInput onSubmit={handleSubmit}>
            <PromptInputTextarea
              ref={textareaRef}
              placeholder={
                ready
                  ? "z.B. Pumpe 5 Minuten an, Wetter, Status…"
                  : "Lade Session…"
              }
              disabled={!ready || !token}
            />
            <PromptInputFooter className="justify-end">
              <PromptInputSubmit
                status={busy ? "streaming" : undefined}
                disabled={!ready || !token}
              />
            </PromptInputFooter>
          </PromptInput>
        </div>
      </div>
    </div>
  );
}
