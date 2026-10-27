"use client";

import { Check, Loader2, SendHorizontal, Sparkles, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import clsx from "clsx";
import type MiniSearch from "minisearch";
import { chunkLabel } from "@/lib/db";
import { hybridSearch, type SearchResult } from "@/lib/rag/search";
import { postJson, postStream, readTextStream } from "@/lib/stream";
import type { Chunk, GlossaryTerm, QueryPlan } from "@/lib/types";
import { useReader } from "@/stores/reader";

type StepState = "running" | "done" | "skipped";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  steps?: { label: string; state: StepState; detail?: string }[];
  retrieval?: SearchResult;
  status?: "working" | "streaming" | "done" | "error";
}

interface Props {
  title: string;
  chunks: Chunk[];
  index: MiniSearch<Chunk>;
  glossary: GlossaryTerm[];
}

const SUGGESTIONS = ["这篇论文解决了什么问题？", "核心方法的直觉是什么？", "实验结果说明了什么？", "这项工作有哪些局限？"];

const STRENGTH = {
  high: { label: "依据充分", cls: "text-emerald-300 bg-emerald-400/10" },
  medium: { label: "依据一般", cls: "text-amber-300 bg-amber-400/10" },
  low: { label: "依据不足", cls: "text-red-300 bg-red-400/10" },
} as const;

/**
 * 溯源问答面板。一次提问的智能流程（界面上逐步可视化）：
 * 查询改写 → 混合检索（关键词 + 端侧向量）→ 带引用约束的流式生成
 */
export function ChatPanel({ title, chunks, index, glossary }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const chunksRef = useRef(chunks);
  chunksRef.current = chunks;
  const { focus, pendingQuestion, consumeQuestion } = useReader();

  const patch = (id: string, fn: (m: Message) => Message) =>
    setMessages((ms) => ms.map((m) => (m.id === id ? fn(m) : m)));

  const send = useCallback(
    async (question: string) => {
      const q = question.trim();
      if (!q || busy) return;
      setInput("");
      setBusy(true);
      const controller = new AbortController();
      abortRef.current = controller;

      const history = messages
        .filter((m) => m.status !== "error")
        .slice(-6)
        .map((m) => ({ role: m.role, content: m.content }));
      const aid = crypto.randomUUID();
      setMessages((ms) => [
        ...ms,
        { id: crypto.randomUUID(), role: "user", content: q },
        {
          id: aid,
          role: "assistant",
          content: "",
          status: "working",
          steps: [{ label: "理解问题，生成检索词", state: "running" }],
        },
      ]);

      try {
        // 1. 查询改写：失败时不阻断，直接用原问题检索
        let plan: QueryPlan | null = null;
        try {
          plan = await postJson<QueryPlan>("/api/query-plan", { question: q, title }, controller.signal);
        } catch {
          plan = null;
        }
        patch(aid, (m) => ({
          ...m,
          steps: [
            { label: "理解问题，生成检索词", state: plan ? "done" : "skipped", detail: plan?.keywords.join(" · ") },
            { label: "混合检索原文", state: "running" },
          ],
        }));

        // 2. 混合检索
        const retrieval = await hybridSearch({
          question: q,
          chunks: chunksRef.current,
          index,
          glossary,
          rewritten: plan ? [plan.rewritten, ...plan.keywords] : [],
        });
        focus(
          retrieval.hits.map((h) => h.chunk.ref),
          { scroll: false },
        );
        patch(aid, (m) => ({
          ...m,
          retrieval,
          status: "streaming",
          steps: [
            m.steps![0],
            {
              label: "混合检索原文",
              state: "done",
              detail: `命中 ${retrieval.hits.length} 段 · ${retrieval.usedVector ? "关键词 + 向量" : "关键词"}`,
            },
            { label: "基于原文生成回答", state: "running" },
          ],
        }));

        // 3. 流式生成
        const res = await postStream(
          "/api/chat",
          {
            question: q,
            history,
            contexts: retrieval.hits.map((h) => ({ ref: h.chunk.ref, label: chunkLabel(h.chunk), text: h.chunk.text })),
          },
          controller.signal,
        );
        await readTextStream(res, (text) => patch(aid, (m) => ({ ...m, content: text })), controller.signal);
        patch(aid, (m) => ({
          ...m,
          status: "done",
          steps: m.steps!.map((s) => (s.state === "running" ? { ...s, state: "done" } : s)),
        }));
      } catch (err) {
        const aborted = controller.signal.aborted;
        patch(aid, (m) => ({
          ...m,
          status: aborted ? "done" : "error",
          content: m.content || (aborted ? "（已停止）" : `出错了：${(err as Error).message}`),
          steps: m.steps?.map((s) => (s.state === "running" ? { ...s, state: "skipped" } : s)),
        }));
      } finally {
        setBusy(false);
        abortRef.current = null;
      }
    },
    [busy, messages, title, index, glossary, focus],
  );

  // 接收来自轨迹节点、划词等入口的提问
  useEffect(() => {
    if (pendingQuestion && !busy) {
      const q = consumeQuestion();
      if (q) void send(q);
    }
  }, [pendingQuestion, busy, consumeQuestion, send]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const refToChunk = new Map(chunks.map((c) => [c.ref, c]));

  return (
    <div className="flex h-full flex-col">
      <div ref={scrollRef} className="scrollbar-thin flex-1 space-y-4 overflow-y-auto p-4">
        {messages.length === 0 && (
          <div className="pt-6 text-center">
            <Sparkles className="mx-auto mb-3 h-6 w-6 text-accent" />
            <div className="text-sm text-muted">问我任何关于这篇论文的问题，回答会标注原文出处</div>
            <div className="mt-5 flex flex-col gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="rounded-lg border border-line px-3 py-2 text-left text-sm text-fg/85 transition hover:border-line-strong hover:bg-white/[0.03]"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m) =>
          m.role === "user" ? (
            <div key={m.id} className="ml-8 rounded-xl rounded-br-sm bg-accent/15 px-3.5 py-2.5 text-sm">
              {m.content}
            </div>
          ) : (
            <div key={m.id} className="space-y-2">
              {m.steps && <Steps steps={m.steps} />}
              {m.content && (
                <div
                  className={clsx(
                    "prose-answer text-sm leading-relaxed",
                    m.status === "streaming" && "caret",
                    m.status === "error" && "text-red-300",
                  )}
                >
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      a: ({ href, children }) => {
                        if (href?.startsWith("#cite-")) {
                          const ref = href.slice(6);
                          const c = refToChunk.get(ref);
                          return (
                            <button
                              onClick={() => focus([ref])}
                              title={c?.text.slice(0, 160)}
                              className="mx-0.5 inline-flex -translate-y-px items-center rounded bg-accent/15 px-1.5 text-[11px] leading-5 text-accent hover:bg-accent/30"
                            >
                              {c ? `P${c.page}` : ref}
                            </button>
                          );
                        }
                        return (
                          <a href={href} target="_blank" rel="noreferrer" className="text-accent underline">
                            {children}
                          </a>
                        );
                      },
                    }}
                  >
                    {linkCitations(m.content)}
                  </ReactMarkdown>
                </div>
              )}
              {m.status === "done" && m.retrieval && (
                <div className="flex items-center gap-2 text-[11px]">
                  <span className={clsx("rounded px-1.5 py-0.5", STRENGTH[m.retrieval.strength].cls)}>
                    {STRENGTH[m.retrieval.strength].label}
                  </span>
                  <span className="text-faint">AI 生成内容，请以原文为准</span>
                </div>
              )}
            </div>
          ),
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
        className="border-t border-line p-3"
      >
        <div className="flex items-end gap-2 rounded-xl border border-line bg-black/20 p-2 focus-within:border-line-strong">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send(input);
              }
            }}
            rows={1}
            placeholder="提问，Enter 发送"
            className="max-h-32 flex-1 resize-none bg-transparent px-1 py-1 text-sm outline-none placeholder:text-faint"
          />
          {busy ? (
            <button
              type="button"
              aria-label="停止生成"
              onClick={() => abortRef.current?.abort()}
              className="rounded-lg bg-white/10 p-2 hover:bg-white/15"
            >
              <X className="h-4 w-4" />
            </button>
          ) : (
            <button
              type="submit"
              aria-label="发送"
              disabled={!input.trim()}
              className="rounded-lg bg-accent p-2 text-[#0b0d1f] transition disabled:opacity-30"
            >
              <SendHorizontal className="h-4 w-4" />
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

function Steps({ steps }: { steps: NonNullable<Message["steps"]> }) {
  return (
    <ol className="space-y-1 rounded-lg border border-line bg-black/15 px-3 py-2 text-xs">
      {steps.map((s) => (
        <li key={s.label} className="flex items-center gap-2 text-muted">
          {s.state === "running" ? (
            <Loader2 className="h-3 w-3 animate-spin text-accent" />
          ) : s.state === "done" ? (
            <Check className="h-3 w-3 text-emerald-300" />
          ) : (
            <span className="h-3 w-3 text-center leading-3 text-faint">–</span>
          )}
          <span className={clsx(s.state === "running" && "text-fg")}>{s.label}</span>
          {s.detail && <span className="truncate text-faint">{s.detail}</span>}
        </li>
      ))}
    </ol>
  );
}

/** 把模型输出的 [[c12]] / [[c12, c13]] 引用标记转成可点击的内部链接 */
function linkCitations(text: string) {
  return text.replace(/\[\[\s*(c\d+(?:\s*[,，]\s*c\d+)*)\s*\]\]/g, (_, refs: string) =>
    refs
      .split(/[,，]/)
      .map((r) => `[${r.trim()}](#cite-${r.trim()})`)
      .join(""),
  );
}
