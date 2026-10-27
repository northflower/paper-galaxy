"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { ArrowLeft, ListTree, MessagesSquare, Minus, Moon, PanelRight, Plus, Sun, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { chunkLabel, db, getChunks } from "@/lib/db";
import { useChunkBoxes } from "@/lib/hooks/useChunkBoxes";
import { usePaperAnalysis } from "@/lib/hooks/usePaperAnalysis";
import { useTranslator } from "@/lib/hooks/useTranslator";
import { buildIndex } from "@/lib/rag/search";
import { useReader, type ViewMode } from "@/stores/reader";
import { buildTermMatcher, ChunkRow } from "./ChunkRow";
import { GlossaryPanel } from "./GlossaryPanel";
import { PaperOutline } from "./PaperOutline";
import { PdfView } from "./PdfView";
import { SelectionToolbar } from "./SelectionToolbar";

const MODES: { value: ViewMode; label: string }[] = [
  { value: "original", label: "原文" },
  { value: "bilingual", label: "对照" },
  { value: "translation", label: "译文" },
];

export function PaperReader({ id, focusRef }: { id: string; focusRef?: string }) {
  // 未找到时返回 null，与“加载中”的 undefined 区分
  const paper = useLiveQuery(() => db.papers.get(id).then((p) => p ?? null), [id]);
  const chunks = useLiveQuery(() => getChunks(id), [id]);
  const analysis = usePaperAnalysis(paper ?? undefined, chunks);
  useChunkBoxes(paper ?? undefined, chunks);
  const glossaryReady = analysis.glossary.status === "done" || analysis.glossary.status === "error";
  const translator = useTranslator(paper?.glossary, glossaryReady);
  const { viewMode, setViewMode, sideTab, setSideTab, activeRefs, reset } = useReader();
  // 小屏为抽屉；桌面端 AI 面板可收起
  const [panelOpen, setPanelOpen] = useState(false);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [panelHidden, setPanelHidden] = useState(false);
  // 左栏默认收起，把宽度留给 PDF；需要时从顶栏打开
  const [railHidden, setRailHidden] = useState(true);
  const articleRef = useRef<HTMLElement>(null);
  // 缩放：1 = 页面铺满阅读区宽度；可用按钮或 Ctrl + 滚轮调整
  const [zoom, setZoom] = useState(1);
  const zoomBy = (delta: number) => setZoom((z) => Math.round(Math.min(2.5, Math.max(0.5, z + delta)) * 10) / 10);
  useEffect(() => {
    const el = articleRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      setZoom((z) => Math.round(Math.min(2.5, Math.max(0.5, z * (e.deltaY < 0 ? 1.08 : 1 / 1.08))) * 100) / 100);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  });
  // 夜间纸张：把 PDF 页面反色成深色，记在本机
  const [night, setNight] = useState(true);
  useEffect(() => {
    try {
      // 默认深色纸张，与整体界面一致
      setNight(localStorage.getItem("pg-night") !== "0");
    } catch {}
  }, []);
  const toggleNight = () => {
    setNight((v) => {
      try {
        localStorage.setItem("pg-night", v ? "0" : "1");
      } catch {}
      return !v;
    });
  };

  useEffect(() => reset, [id, reset]);

  // 从论文库检索结果跳转过来时，定位并高亮对应段落
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

  // 从脉络、术语、划词等入口发起提问时，确保问答面板可见
  const pendingQuestion = useReader((s) => s.pendingQuestion);
  useEffect(() => {
    if (!pendingQuestion) return;
    setPanelOpen(true);
    setPanelHidden(false);
    setOutlineOpen(false);
  }, [pendingQuestion]);

  if (paper === undefined || chunks === undefined) {
    return <div className="flex min-h-dvh items-center justify-center text-sm text-faint">正在载入…</div>;
  }
  if (paper === null) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 text-sm text-muted">
        没有找到这篇论文
        <Link href="/" className="text-accent hover:underline">
          返回论文库
        </Link>
      </div>
    );
  }

  const body = chunks.filter((c) => c.kind !== "reference");
  const references = chunks.filter((c) => c.kind === "reference");
  const headings = body.filter((c) => c.kind === "heading");
  const translated = body.filter((c) => c.kind === "paragraph" && c.translation).length;
  const progress = analysis.paragraphCount ? Math.round((translated / analysis.paragraphCount) * 100) : 0;
  const labelOf = (ref: string) => {
    const c = refMap.get(ref);
    return c ? chunkLabel(c) : ref;
  };
  const embed = analysis.embedding;
  const embedLabel =
    embed.status === "running"
      ? `正在建立语义索引 ${Math.round(embed.progress)}%`
      : embed.status === "done"
        ? "语义检索就绪"
        : embed.status === "error"
          ? "语义检索不可用，问答使用关键词检索"
          : "准备建立语义索引";

  return (
    <div className="min-h-dvh">
      <header className="glass sticky top-0 z-30 border-x-0 border-t-0">
        <div className="flex h-14 items-center gap-1.5 px-3 sm:gap-2 sm:px-5">
          <Link href="/" aria-label="返回论文库" className="rounded-lg p-2 text-muted transition hover:bg-white/5 hover:text-fg">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <button
            aria-label="论文脉络与目录"
            onClick={() => (window.innerWidth >= 1280 ? setRailHidden((v) => !v) : setOutlineOpen(true))}
            className={clsx("rounded-lg p-2 transition hover:bg-white/5 hover:text-fg", railHidden ? "text-faint" : "text-muted")}
          >
            <ListTree className="h-4 w-4" />
          </button>
          <div className="min-w-0 flex-1 px-1 text-sm font-medium text-fg/90">
            <div className="truncate">{paper.title}</div>
          </div>

          <div className="hidden items-center gap-3 pr-2 text-xs text-faint md:flex">
            <span title={`已翻译 ${translated}/${analysis.paragraphCount} 段`} className="flex items-center gap-2">
              <span className="relative h-1 w-16 overflow-hidden rounded-full bg-white/[0.06]">
                <span className="absolute inset-y-0 left-0 rounded-full bg-accent/70 transition-all" style={{ width: `${progress}%` }} />
              </span>
              <span className="tabular-nums">译 {progress}%</span>
            </span>
            <span
              title={embed.error ?? embedLabel}
              className={clsx(
                "h-1.5 w-1.5 rounded-full",
                embed.status === "done" ? "bg-emerald-400/80" : embed.status === "error" ? "bg-amber-400/80" : "animate-pulse bg-white/30",
              )}
            />
          </div>

          {paper.file && (
            <div className="hidden items-center rounded-lg bg-white/[0.04] p-0.5 text-xs sm:flex">
              <button aria-label="缩小" onClick={() => zoomBy(-0.1)} className="rounded-md p-1.5 text-muted transition hover:bg-white/[0.08] hover:text-fg">
                <Minus className="h-3.5 w-3.5" />
              </button>
              <button
                title="适应宽度"
                onClick={() => setZoom(1)}
                className="min-w-[3.25rem] rounded-md px-1 py-1 text-center tabular-nums text-muted transition hover:bg-white/[0.08] hover:text-fg"
              >
                {Math.round(zoom * 100)}%
              </button>
              <button aria-label="放大" onClick={() => zoomBy(0.1)} className="rounded-md p-1.5 text-muted transition hover:bg-white/[0.08] hover:text-fg">
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          <div role="radiogroup" aria-label="阅读模式" className="flex shrink-0 rounded-lg bg-white/[0.04] p-0.5 text-xs">
            {MODES.map((m) => (
              <button
                key={m.value}
                role="radio"
                aria-checked={viewMode === m.value}
                onClick={() => setViewMode(m.value)}
                className={clsx(
                  "rounded-md px-2.5 py-1 transition sm:px-3",
                  viewMode === m.value ? "bg-white/[0.1] text-fg shadow-sm" : "text-faint hover:text-muted",
                )}
              >
                {m.label}
              </button>
            ))}
          </div>
          {paper.file && (
            <button
              aria-label={night ? "原色纸张" : "夜间纸张"}
              title={night ? "原色纸张" : "夜间纸张"}
              onClick={toggleNight}
              className="rounded-lg p-2 text-muted transition hover:bg-white/5 hover:text-fg"
            >
              {night ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
          )}
          <button
            aria-label={panelHidden ? "展开 AI 面板" : "收起 AI 面板"}
            onClick={() => setPanelHidden((v) => !v)}
            className={clsx(
              "hidden rounded-lg p-2 transition hover:bg-white/5 hover:text-fg lg:block",
              panelHidden ? "text-faint" : "text-muted",
            )}
          >
            <PanelRight className="h-4 w-4" />
          </button>
        </div>
      </header>

      <div
        className={clsx(
          "grid gap-4 px-3 pb-24 pt-4 sm:px-4",
          !panelHidden && "lg:grid-cols-[minmax(0,1fr)_380px]",
          // 桌面端左右两栏都可收起，把空间让给 PDF 页面
          railHidden
            ? panelHidden
              ? "xl:grid-cols-[minmax(0,1fr)]"
              : "xl:grid-cols-[minmax(0,1fr)_380px]"
            : panelHidden
              ? "xl:grid-cols-[248px_minmax(0,1fr)]"
              : "xl:grid-cols-[248px_minmax(0,1fr)_380px]",
        )}
      >
        {/* 左栏：脉络 / 目录。xl 常驻，小屏为抽屉 */}
        {outlineOpen && <div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm xl:hidden" onClick={() => setOutlineOpen(false)} />}
        <aside
          className={clsx(
            "xl:sticky xl:top-[76px] xl:h-[calc(100dvh-96px)] xl:pt-1",
            railHidden ? "xl:hidden" : "xl:block",
            outlineOpen ? "panel fixed inset-y-0 left-0 z-50 w-[300px] p-4 pt-5 xl:static xl:w-auto xl:border-0 xl:bg-none xl:p-0 xl:shadow-none" : "hidden",
          )}
        >
          <PaperOutline
            nodes={paper.trajectory}
            oneLiner={paper.oneLiner}
            status={analysis.trajectory.status}
            error={analysis.trajectory.error}
            headings={headings}
            labelOf={labelOf}
            onRetry={analysis.retryTrajectory}
            onNavigate={() => setOutlineOpen(false)}
          />
        </aside>

        {paper.file ? (
          <article ref={articleRef} className="scrollbar-thin min-w-0 overflow-x-auto">
            <PdfView
              zoom={zoom}
              paperId={paper.id}
              file={paper.file}
              chunks={body}
              mode={viewMode}
              activeSet={activeSet}
              night={night}
              translator={translator}
            />
          </article>
        ) : (
          <article ref={articleRef} className="panel min-w-0 rounded-2xl px-3 py-8 sm:px-10 sm:py-12">
            <div className="mx-auto max-w-[720px]">
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
                <details className="mt-14 border-t border-line pt-6 text-sm text-muted">
                  <summary className="cursor-pointer select-none text-faint transition hover:text-fg">参考文献 · {references.length}</summary>
                  <ol className="mt-4 space-y-2 font-serif text-[13px] leading-relaxed">
                    {references.map((r) => (
                      <li key={r.id}>{r.text}</li>
                    ))}
                  </ol>
                </details>
              )}
            </div>
          </article>
        )}

        <aside
          className={clsx(
            "panel z-40 flex flex-col overflow-hidden",
            "max-lg:fixed max-lg:inset-0 max-lg:rounded-none",
            "lg:sticky lg:top-[76px] lg:h-[calc(100dvh-96px)] lg:rounded-2xl",
            !panelOpen && "max-lg:hidden",
            panelHidden && "lg:hidden",
          )}
        >
          <div className="flex items-center gap-2 p-3">
            <div className="flex flex-1 gap-1 rounded-lg bg-white/[0.03] p-0.5 text-xs">
              {(
                [
                  ["chat", "问答"],
                  ["glossary", "术语"],
                ] as const
              ).map(([tab, label]) => (
                <button
                  key={tab}
                  onClick={() => setSideTab(tab)}
                  className={clsx(
                    "flex-1 rounded-md py-1.5 transition",
                    sideTab === tab ? "bg-white/[0.08] text-fg shadow-sm" : "text-faint hover:text-muted",
                  )}
                >
                  {label}
                  {tab === "glossary" && paper.glossary && <span className="ml-1 text-faint">{paper.glossary.length}</span>}
                </button>
              ))}
            </div>
            <button aria-label="关闭面板" onClick={() => setPanelOpen(false)} className="p-1.5 text-muted lg:hidden">
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="min-h-0 flex-1 border-t border-line">
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

      <button
        onClick={() => setPanelOpen(true)}
        className="fixed bottom-5 right-5 z-30 flex items-center gap-2 rounded-full border border-white/10 bg-[#171a26]/90 px-4 py-3 text-sm font-medium text-fg shadow-[0_12px_40px_-8px_rgba(0,0,0,0.8)] backdrop-blur lg:hidden"
      >
        <MessagesSquare className="h-4 w-4 text-accent" /> 问 AI
      </button>
      <SelectionToolbar containerRef={articleRef} glossary={paper.glossary ?? []} />
    </div>
  );
}
