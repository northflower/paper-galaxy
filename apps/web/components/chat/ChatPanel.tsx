"use client";

import { Check, Loader2, RotateCcw, SendHorizontal, Sparkles, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import clsx from "clsx";
import type MiniSearch from "minisearch";
import { chunkLabel, db } from "@/lib/db";
import { hybridSearch, type SearchResult } from "@/lib/rag/search";
import { postJson, postStream, readTextStream } from "@/lib/stream";
import type { Chunk, GlossaryTerm, QueryPlan, SavedMessage } from "@/lib/types";
import { useReader, type VisionRequest } from "@/stores/reader";

/** 消息结构见 SavedMessage；本次会话内额外带上完整检索结果 */
interface Message extends SavedMessage {
  retrieval?: SearchResult;
}

interface Props {
  paperId: string;
  /** 上次保存的问答记录 */
  saved?: SavedMessage[];
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
export function ChatPanel({ paperId, saved, title, chunks, index, glossary }: Props) {
  const [messages, setMessages] = useState<Message[]>(() => saved ?? []);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const chunksRef = useRef(chunks);
  chunksRef.current = chunks;
  const { focus, pendingQuestion, consumeQuestion, pendingVision, consumeVision } = useReader();

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

  // 多模态讲解：框选的图表 / 公式截图 + 本页原文 → 视觉模型流式讲解
  const explainRegion = useCallback(
    async (req: VisionRequest) => {
      if (busy) return;
      setBusy(true);
      const controller = new AbortController();
      abortRef.current = controller;
      const aid = crypto.randomUUID();
      setMessages((ms) => [
        ...ms,
        { id: crypto.randomUUID(), role: "user", content: `讲解第 ${req.page} 页框选的内容`, image: req.image },
        {
          id: aid,
          role: "assistant",
          content: "",
          status: "working",
          steps: [{ label: "视觉模型识别图像", state: "running", detail: req.context ? "结合本页原文" : undefined }],
        },
      ]);
      try {
        const res = await postStream("/api/vision", { image: req.image, page: req.page, title, context: req.context }, controller.signal);
        await readTextStream(
          res,
          (text) => patch(aid, (m) => ({ ...m, content: text, status: "streaming" })),
          controller.signal,
        );
        patch(aid, (m) => ({ ...m, status: "done", steps: m.steps!.map((s) => ({ ...s, state: "done" })) }));
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
    [busy, title],
  );

  useEffect(() => {
    if (pendingVision && !busy) {
      const v = consumeVision();
      if (v) void explainRegion(v);
    }
  }, [pendingVision, busy, consumeVision, explainRegion]);

  // 接收来自轨迹节点、划词等入口的提问
  useEffect(() => {
    if (pendingQuestion && !busy) {
      const q = consumeQuestion();
      if (q) void send(q);
    }
  }, [pendingQuestion, busy, consumeQuestion, send]);

  // 每轮回答结束后写回本地库：刷新页面、下次打开都能看到之前的问答
  useEffect(() => {
    if (busy) return;
    const toSave: SavedMessage[] = messages.map(({ retrieval, ...m }) => ({
      ...m,
      strength: retrieval?.strength ?? m.strength,
      status: m.status === "error" ? "error" : "done",
    }));
    void db.papers.update(paperId, { chat: toSave });
  }, [busy, messages, paperId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const refToChunk = new Map(chunks.map((c) => [c.ref, c]));

  return (
    <div className="flex h-full flex-col">
      <div ref={scrollRef} className="scrollbar-thin flex-1 space-y-4 overflow-y-auto p-4">
        {messages.length === 0 && (
          <div className="flex h-full flex-col justify-end pb-2">
            <div className="mb-3 flex items-center gap-2 text-[13px] text-muted">
              <Sparkles className="h-3.5 w-3.5 text-accent" /> 向这篇论文提问
            </div>
            <div className="flex flex-col gap-1.5">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="btn-ghost px-3 py-2 text-left text-[13px] text-fg/80"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m) =>
          m.role === "user" ? (
            <div key={m.id} className="ml-10 rounded-2xl rounded-br-md bg-white/[0.07] px-3.5 py-2.5 text-[13.5px] leading-relaxed">
              {m.image && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={m.image} alt="框选区域" className="mb-2 max-h-48 w-full rounded-lg bg-white object-contain" />
              )}
              {m.content}
            </div>
          ) : (
            <div key={m.id} className="space-y-2">
              {m.steps && <Steps steps={m.steps} />}
              {m.content && (
                <div
                  className={clsx(
                    "prose-answer text-[13.5px] leading-[1.75] text-fg/90",
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
              {m.status === "done" && (m.retrieval?.strength ?? m.strength) && (
                <div className="flex items-center gap-2 text-[11px]">
                  <span className={clsx("rounded px-1.5 py-0.5", STRENGTH[(m.retrieval?.strength ?? m.strength)!].cls)}>
                    {STRENGTH[(m.retrieval?.strength ?? m.strength)!].label}
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
        className="relative border-t border-line p-3"
      >
        {messages.length > 0 && !busy && (
          <button
            type="button"
            onClick={() => confirm("清空这篇论文的问答记录？") && setMessages([])}
            className="absolute -top-8 right-3 flex items-center gap-1 rounded-md bg-bg/80 px-2 py-1 text-[11px] text-faint backdrop-blur transition hover:text-muted"
          >
            <RotateCcw className="h-3 w-3" /> 新对话
          </button>
        )}
        <div className="flex items-end gap-2 rounded-xl border border-line bg-white/[0.02] p-2 transition focus-within:border-line-strong focus-within:bg-white/[0.04]">
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
            placeholder="输入问题…"
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
              className="rounded-lg bg-fg p-2 text-bg transition hover:bg-white disabled:opacity-20"
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
    <ol className="space-y-1 border-l border-line py-0.5 pl-3 text-xs">
      {steps.map((s) => (
        <li key={s.label} className="flex items-center gap-2 text-muted">
          {s.state === "running" ? (
            <Loader2 className="h-3 w-3 shrink-0 animate-spin text-accent" />
          ) : s.state === "done" ? (
            <Check className="h-3 w-3 shrink-0 text-emerald-300" />
          ) : (
            <span className="h-3 w-3 shrink-0 text-center leading-3 text-faint">–</span>
          )}
          <span className={clsx("shrink-0 whitespace-nowrap", s.state === "running" && "text-fg")}>{s.label}</span>
          {s.detail && <span className="min-w-0 truncate text-faint" title={s.detail}>{s.detail}</span>}
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
