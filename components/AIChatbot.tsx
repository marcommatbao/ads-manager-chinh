"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Bot, X, Send, Loader2, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/messages";

// ── Types ──
interface ChatMessage {
  role: "user" | "model";
  content: string;
}

// ── Quick actions ──
const QUICK_ACTIONS: { label: MessageKey; prompt: MessageKey }[] = [
  { label: "panels.chatbot.qa1.label", prompt: "panels.chatbot.qa1.prompt" },
  { label: "panels.chatbot.qa2.label", prompt: "panels.chatbot.qa2.prompt" },
  { label: "panels.chatbot.qa3.label", prompt: "panels.chatbot.qa3.prompt" },
  { label: "panels.chatbot.qa4.label", prompt: "panels.chatbot.qa4.prompt" },
];

// Escape HTML special chars before any markdown substitution below —
// renderMarkdown's output goes straight into dangerouslySetInnerHTML
// (see the message list render), so raw text containing "<script>" or
// similar (e.g. echoed back from Gemini after summarizing external data
// like an Odoo contact name or a competitor's ad copy) would otherwise
// execute as live HTML in every teammate's browser. Escaping first means
// only the markup we construct ourselves below can ever become a real tag.
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ── Simple markdown renderer ──
function renderMarkdown(text: string) {
  return text
    .split("\n")
    .map((line, i) => {
      line = escapeHtml(line);
      // Bold
      let html = line.replace(/\*\*(.+?)\*\*/g, '<strong class="font-semibold text-slate-800">$1</strong>');
      // Inline code
      html = html.replace(/`([^`]+)`/g, '<code class="bg-slate-100 text-slate-700 text-[11px] px-1 py-0.5 rounded">$1</code>');
      // Bullet points
      if (/^[-•]/.test(html.trim())) {
        html = `<span class="pl-2 block">${html.trim().replace(/^[-•]\s*/, "• ")}</span>`;
      }
      // Headers
      if (html.startsWith("### ")) html = `<p class="font-bold text-sm text-slate-800 mt-2 mb-0.5">${html.slice(4)}</p>`;
      else if (html.startsWith("## ")) html = `<p class="font-bold text-sm text-slate-800 mt-2 mb-0.5">${html.slice(3)}</p>`;

      return html;
    })
    .join("<br/>");
}

// ── Session storage key ──
const CHAT_STORAGE_KEY = "adscommand_chat_history";

function loadHistory(): ChatMessage[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = sessionStorage.getItem(CHAT_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveHistory(msgs: ChatMessage[]) {
  try {
    // Keep last 20 messages to avoid storage overflow
    sessionStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(msgs.slice(-20)));
  } catch { /* ignore */ }
}

export default function AIChatbot() {
  const t = useT();
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [hasInteracted, setHasInteracted] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Restore history on mount
  useEffect(() => {
    const history = loadHistory();
    if (history.length > 0) {
      setMessages(history);
      setHasInteracted(true);
    }
  }, []);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) inputRef.current?.focus();
  }, [isOpen]);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || isLoading) return;

    const userMsg: ChatMessage = { role: "user", content: text.trim() };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");
    setIsLoading(true);
    setHasInteracted(true);

    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: newMessages }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: t("panels.chatbot.serverError") }));
        const errMsg: ChatMessage = { role: "model", content: `❌ ${err.error || t("panels.chatbot.noConnect")}` };
        const updated = [...newMessages, errMsg];
        setMessages(updated);
        saveHistory(updated);
        return;
      }

      // Stream response
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";

      // Add empty model message that we'll update
      const streamMessages = [...newMessages, { role: "model" as const, content: "" }];
      setMessages(streamMessages);

      // AdsBot is advisory only — the route never emits action markers and
      // this client performs no mutations. Anything that changes an account
      // goes through Improvements → Apply / Campaigns, which are
      // permission-checked and audited.
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        accumulated += decoder.decode(value, { stream: true });

        const updated = [...newMessages, { role: "model" as const, content: accumulated }];
        setMessages(updated);
      }

      const final = [...newMessages, { role: "model" as const, content: accumulated }];
      setMessages(final);
      saveHistory(final);
    } catch (err) {
      const errMsg: ChatMessage = { role: "model", content: `❌ ${t("panels.chatbot.connError", { msg: err instanceof Error ? err.message : "Unknown" })}` };
      const updated = [...newMessages, errMsg];
      setMessages(updated);
      saveHistory(updated);
    } finally {
      setIsLoading(false);
    }
  }, [messages, isLoading, t]);

  const clearHistory = () => {
    setMessages([]);
    setHasInteracted(false);
    sessionStorage.removeItem(CHAT_STORAGE_KEY);
  };

  return (
    <>
      {/* ── Floating Button ── */}
      {/* FAB sits above bottom nav on mobile/tablet (lg:hidden nav = 4rem = --nav-h).
          On desktop (lg+) bottom nav is gone so we use simple bottom-8.
          Size: h-12/w-12 (48px) on mobile to leave more room; h-14/w-14 on desktop. */}
      <button
        onClick={() => setIsOpen(prev => !prev)}
        className={cn(
          "fixed z-50 flex items-center justify-center rounded-full shadow-lg transition-all duration-300 hover:scale-105",
          // Mobile/tablet: sit 1rem above top of bottom nav + safe area
          "bottom-[calc(var(--nav-h)+1rem+env(safe-area-inset-bottom))] right-4 h-12 w-12",
          // Desktop: bottom nav gone, normal positioning
          "lg:bottom-8 lg:right-8 lg:h-14 lg:w-14",
          isOpen
            ? "bg-slate-700 text-white"
            : "bg-gradient-to-br from-amber-500 to-orange-600 text-amber-950 animate-pulse hover:animate-none"
        )}
        title={t("panels.chatbot.fabTitle")}
      >
        {isOpen ? <X className="h-5 w-5 lg:h-6 lg:w-6" /> : <Bot className="h-5 w-5 lg:h-6 lg:w-6" />}
      </button>

      {/* ── Chat Panel ──
          Mobile/tablet: bottom = nav (4rem) + nav-gap (1rem) + FAB (3rem) + panel-gap (0.75rem) + safe area
          Panel width fills screen minus 2rem margin; capped at 380px on wider screens.
          Desktop (lg+): standard positioning. */}
      {isOpen && (
        <div className={cn(
          "fixed z-50 flex flex-col overflow-hidden",
          "bottom-[calc(var(--nav-h)+5rem+env(safe-area-inset-bottom))] right-4",
          "w-[calc(100vw-2rem)] max-w-[380px] max-h-[65vh]",
          "rounded-2xl border border-slate-200 bg-white shadow-2xl",
          "lg:bottom-28 lg:right-8 lg:w-[380px] lg:max-h-[70vh]",
        )}>
          {/* Header */}
          <div className="bg-gradient-to-r from-amber-500 to-orange-600 px-4 py-3 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2">
              <div className="rounded-full bg-white/20 p-1.5">
                <Bot className="h-4 w-4 text-white" />
              </div>
              <div>
                <p className="text-sm font-bold text-white">AdsBot</p>
                <p className="text-[10px] text-amber-100">{t("panels.chatbot.subtitle")}</p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              {messages.length > 0 && (
                <button
                  onClick={clearHistory}
                  className="p-1.5 rounded-lg hover:bg-white/20 text-white/70 hover:text-white transition-colors"
                  title={t("panels.chatbot.clear")}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
              <div className="flex items-center gap-1 text-[10px] text-amber-100 bg-white/10 rounded-full px-2 py-0.5">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Online
              </div>
            </div>
          </div>

          {/* Messages Area */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-[200px] max-h-[45vh]">
            {/* Welcome message */}
            {!hasInteracted && messages.length === 0 && (
              <div className="space-y-3">
                <div className="rounded-xl bg-gradient-to-br from-amber-50 to-orange-50 border border-amber-100 p-3">
                  <p className="text-xs font-semibold text-amber-900 mb-1">{t("panels.chatbot.hello")}</p>
                  <p className="text-[11px] text-amber-800 leading-relaxed">
                    {t("panels.chatbot.introA")} <strong>AdsBot</strong> {t("panels.chatbot.introB")}
                  </p>
                </div>

                {/* Quick actions */}
                <div>
                  <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-2">{t("panels.chatbot.quick")}</p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {QUICK_ACTIONS.map((action, i) => (
                      <button
                        key={i}
                        onClick={() => sendMessage(t(action.prompt))}
                        className="text-left rounded-lg border border-slate-200 bg-white p-2 text-[11px] text-slate-600 hover:border-amber-300 hover:bg-amber-50/50 transition-all leading-snug"
                      >
                        {t(action.label)}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Chat messages */}
            {messages.map((msg, i) => (
              <div
                key={i}
                className={cn(
                  "flex",
                  msg.role === "user" ? "justify-end" : "justify-start"
                )}
              >
                <div
                  className={cn(
                    "rounded-xl px-3 py-2 max-w-[85%] text-[12px] leading-relaxed",
                    msg.role === "user"
                      ? "bg-amber-500 text-amber-950 rounded-br-sm"
                      : "bg-slate-100 text-slate-700 rounded-bl-sm border border-slate-200"
                  )}
                >
                  {msg.role === "model" ? (
                    msg.content ? (
                      <>
                        <div
                          className="prose-sm [&_strong]:text-slate-800 [&_code]:text-[10px]"
                          dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }}
                        />
                      </>
                    ) : (
                      <div className="flex items-center gap-1.5 text-slate-400">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        <span className="text-[11px]">{t("panels.chatbot.analyzing")}</span>
                      </div>
                    )
                  ) : (
                    <p>{msg.content}</p>
                  )}
                </div>
              </div>
            ))}

            {/* Loading indicator */}
            {isLoading && messages[messages.length - 1]?.role !== "model" && (
              <div className="flex justify-start">
                <div className="rounded-xl bg-slate-100 border border-slate-200 px-3 py-2 rounded-bl-sm">
                  <div className="flex items-center gap-1.5 text-slate-400">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    <span className="text-[11px]">{t("panels.chatbot.analyzingData")}</span>
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Quick actions (shown when there are messages) */}
          {hasInteracted && messages.length > 0 && !isLoading && (
            <div className="px-4 pb-2 flex gap-1 overflow-x-auto shrink-0">
              {QUICK_ACTIONS.slice(0, 3).map((action, i) => (
                <button
                  key={i}
                  onClick={() => sendMessage(t(action.prompt))}
                  className="whitespace-nowrap rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[10px] text-slate-500 hover:border-amber-300 hover:text-amber-700 transition-colors shrink-0"
                >
                  {t(action.label)}
                </button>
              ))}
            </div>
          )}

          {/* Input Area */}
          <div className="border-t border-slate-100 px-3 py-2.5 flex items-center gap-2 shrink-0 bg-white">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(input); } }}
              placeholder={t("panels.chatbot.placeholder")}
              className="flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[12px] text-slate-700 placeholder:text-slate-400 outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400 transition-all"
              disabled={isLoading}
            />
            <button
              onClick={() => sendMessage(input)}
              disabled={isLoading || !input.trim()}
              className={cn(
                "flex items-center justify-center rounded-lg h-9 w-9 transition-all shrink-0",
                input.trim() && !isLoading
                  ? "bg-amber-500 text-amber-950 hover:bg-amber-600 shadow-sm"
                  : "bg-slate-100 text-slate-400"
              )}
            >
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
