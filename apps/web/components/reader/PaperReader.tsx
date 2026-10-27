"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { ArrowLeft, BookOpen, Cpu, Languages, MessagesSquare, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { StarTrack } from "@/components/trajectory/StarTrack";
import { chunkLabel, db, getChunks } from "@/lib/db";
import { usePaperAnalysis } from "@/lib/hooks/usePaperAnalysis";
import { useTranslator } from "@/lib/hooks/useTranslator";
import { buildIndex } from "@/lib/rag/search";
import { useReader, type ViewMode } from "@/stores/reader";
import { buildTermMatcher, ChunkRow } from "./ChunkRow";
import { GlossaryPanel } from "./GlossaryPanel";
import { SelectionAsk } from "./SelectionAsk";

const MODES: { value: ViewMode; label: string }[] = [
  { value: "bilingual", label: "对照" },
  { value: "original", label: "原文" },
  { value: "translation", label: "译文" },
];

export function PaperReader({ id, focusRef }: { id: string; focusRef?: string }) {
  // 未找到时返回 null，与“加载中”的 undefined 区分
  const paper = useLiveQuery(() => db.papers.get(id).then((p) => p ?? null), [id]);
  const chunks = useLiveQuery(() => getChunks(id), [id]);
  const analysis = usePaperAnalysis(paper ?? undefined, chunks);
  const glossaryReady = analysis.glossary.status === "done" || analysis.glossary.status === "error";
  const translator = useTranslator(paper?.glossary, glossaryReady);
  const { viewMode, setViewMode, sideTab, setSideTab, activeRefs, reset } = useReader();
  const [panelOpen, setPanelOpen] = useState(false);
  const articleRef = useRef<HTMLElement>(null);

  useEffect(() => reset, [id, reset]);

  // 从知识星系跳转过来时，定位并高亮对应段落
  const loaded = !!paper && !!chunks;
  const focus = useReader((s) => s.focus);
  useEffect(() => {
    if (!loaded || !focusRef) return;
    const timer = setTimeout(() => focus([focusRef]), 300);
    return () => clearTimeout(timer);
  }, [loaded, focusRef, focus]);

  const matcher = useMemo(() => buildTermMatcher(paper?.glossary), [paper?.glossary]);
  // 索引只依赖段落文本，翻译、向量写回时不重建
  const chunkCount = chunks?.length ?? 0;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const index = useMemo(() => (chunks ? buildIndex(chunks) : null), [id, chunkCount]);
  const refMap = useMemo(() => new Map((chunks ?? []).map((c) => [c.ref, c])), [chunks]);
  const activeSet = useMemo(() => new Set(activeRefs), [activeRefs]);

  // 移动端：从轨迹或划词发起提问时自动打开面板
  const pendingQuestion = useReader((s) => s.pendingQuestion);
  useEffect(() => {
    if (pendingQuestion) setPanelOpen(true);
  }, [pendingQuestion]);

  if (paper === undefined || chunks === undefined) {
    return <div className="flex min-h-dvh items-center justify-center text-muted">正在载入论文…</div>;
  }
  if (paper === null) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 text-muted">
        没有找到这篇论文
        <Link href="/" className="text-accent hover:underline">
          返回首页
        </Link>
      </div>
    );
  }

  const body = chunks.filter((c) => c.kind !== "reference");
  const references = chunks.filter((c) => c.kind === "reference");
  const translated = body.filter((c) => c.kind === "paragraph" && c.translation).length;
  const labelOf = (ref: string) => {
    const c = refMap.get(ref);
    return c ? chunkLabel(c) : ref;
  };

  return (
    <div className="min-h-dvh">
      <header className="glass sticky top-0 z-30 border-x-0 border-t-0">
        <div className="mx-auto flex max-w-[1600px] items-center gap-3 px-4 py-2.5">
          <Link href="/" aria-label="返回" className="rounded-md p-1.5 text-muted hover:bg-white/5 hover:text-fg">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{paper.title}</div>
            <div className="flex flex-wrap gap-x-3 text-[11px] text-faint">
              <span className="flex items-center gap-1">
                <Languages className="h-3 w-3" /> 已译 {translated}/{analysis.paragraphCount}
              </span>
              <span className="flex items-center gap-1" title={analysis.embedding.error}>
                <Cpu className="h-3 w-3" />
                {analysis.embedding.status === "running"
                  ? `端侧向量化 ${Math.round(analysis.embedding.progress)}%`
                  : analysis.embedding.status === "done"
                    ? "向量检索就绪"
                    : analysis.embedding.status === "error"
                      ? "向量检索不可用，已降级为关键词检索"
                      : "准备向量化"}
              </span>
            </div>
          </div>
          <div role="radiogroup" aria-label="阅读模式" className="flex rounded-lg border border-line p-0.5 text-xs">
            {MODES.map((m) => (
              <button
                key={m.value}
                role="radio"
                aria-checked={viewMode === m.value}
                onClick={() => setViewMode(m.value)}
                className={clsx(
                  "rounded-md px-2.5 py-1 transition",
                  viewMode === m.value ? "bg-accent/20 text-fg" : "text-muted hover:text-fg",
                )}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1600px] px-4 pb-24 pt-4">
        <StarTrack
          nodes={paper.trajectory}
          oneLiner={paper.oneLiner}
          status={analysis.trajectory.status}
          error={analysis.trajectory.error}
          labelOf={labelOf}
          onRetry={analysis.retryTrajectory}
        />

        <div className="mt-4 gap-4 lg:grid lg:grid-cols-[minmax(0,1fr)_380px]">
          <article ref={articleRef} className="glass rounded-2xl px-2 py-6 sm:px-6">
            {body.map((c) => (
              <ChunkRow
                key={c.id}
                chunk={c}
                mode={viewMode}
                active={activeSet.has(c.ref)}
                streamingText={translator.streaming[c.id]}
                error={translator.failed[c.id]}
                matcher={matcher}
                onVisible={translator.request}
              />
            ))}
            {references.length > 0 && (
              <details className="mx-3 mt-10 text-sm text-muted">
                <summary className="cursor-pointer select-none text-faint hover:text-fg">参考文献（{references.length} 条）</summary>
                <ol className="mt-3 space-y-2 font-serif text-xs leading-relaxed">
                  {references.map((r) => (
                    <li key={r.id}>{r.text}</li>
                  ))}
                </ol>
              </details>
            )}
          </article>

          <aside
            className={clsx(
              "glass z-40 flex flex-col overflow-hidden",
              "max-lg:fixed max-lg:inset-0 max-lg:rounded-none max-lg:bg-elev-strong",
              "lg:sticky lg:top-[72px] lg:h-[calc(100dvh-88px)] lg:rounded-2xl",
              !panelOpen && "max-lg:hidden",
            )}
          >
            <div className="flex items-center border-b border-line px-2">
              {(
                [
                  ["chat", "问答", MessagesSquare],
                  ["glossary", "术语表", BookOpen],
                ] as const
              ).map(([tab, label, Icon]) => (
                <button
                  key={tab}
                  onClick={() => setSideTab(tab)}
                  className={clsx(
                    "flex items-center gap-1.5 border-b-2 px-3 py-3 text-sm transition",
                    sideTab === tab ? "border-accent text-fg" : "border-transparent text-muted hover:text-fg",
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {label}
                  {tab === "glossary" && paper.glossary && <span className="text-xs text-faint">{paper.glossary.length}</span>}
                </button>
              ))}
              <button aria-label="关闭面板" onClick={() => setPanelOpen(false)} className="ml-auto p-2 text-muted lg:hidden">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="min-h-0 flex-1">
              {/* 用 hidden 而非条件渲染，切换标签时保留对话记录 */}
              <div className={clsx("h-full", sideTab !== "chat" && "hidden")}>
                {index && <ChatPanel title={paper.title} chunks={chunks} index={index} glossary={paper.glossary ?? []} />}
              </div>
              <div className={clsx("h-full", sideTab !== "glossary" && "hidden")}>
                <GlossaryPanel
                  terms={paper.glossary}
                  status={analysis.glossary.status}
                  error={analysis.glossary.error}
                  onRetry={analysis.retryGlossary}
                />
              </div>
            </div>
          </aside>
        </div>
      </div>

      <button
        onClick={() => setPanelOpen(true)}
        className="fixed bottom-5 right-5 z-30 flex items-center gap-2 rounded-full bg-accent px-4 py-3 text-sm font-medium text-[#0b0d1f] shadow-[0_0_32px_-4px_var(--glow)] lg:hidden"
      >
        <MessagesSquare className="h-4 w-4" /> 问 AI
      </button>
      <SelectionAsk containerRef={articleRef} />
    </div>
  );
}
