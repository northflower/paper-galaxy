"use client";

import { memo, useEffect, useRef, type ReactNode } from "react";
import clsx from "clsx";
import { RotateCw } from "lucide-react";
import type { Chunk, GlossaryTerm } from "@/lib/types";
import type { ViewMode } from "@/stores/reader";

export interface TermMatcher {
  regex: RegExp | null;
  byKey: Map<string, GlossaryTerm>;
}

interface Props {
  chunk: Chunk;
  mode: ViewMode;
  active: boolean;
  streamingText?: string;
  error?: string;
  matcher: TermMatcher;
  onVisible: (chunk: Chunk) => void;
}

/** 单个段落行：原文（术语高亮 + 释义浮层）与译文（流式 / 缓存）并排 */
export const ChunkRow = memo(function ChunkRow({ chunk, mode, active, streamingText, error, matcher, onVisible }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const needsTranslation = chunk.kind === "paragraph" && !chunk.translation && mode !== "original";

  useEffect(() => {
    const el = ref.current;
    // 失败后不再自动重试（避免请求风暴），由用户点击重试
    if (!el || !needsTranslation || error) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          onVisible(chunk);
          io.disconnect();
        }
      },
      { rootMargin: "600px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [chunk, needsTranslation, onVisible, error]);

  if (chunk.kind === "title") {
    return (
      <h1 id={`chunk-${chunk.ref}`} className="mb-6 font-serif text-2xl font-semibold leading-snug sm:text-3xl">
        {chunk.text}
      </h1>
    );
  }

  if (chunk.kind === "heading") {
    return (
      <h2
        id={`chunk-${chunk.ref}`}
        className={clsx(
          "scroll-mt-40 mb-2 mt-8 rounded-lg border border-transparent px-3 py-1 text-lg font-semibold text-[#c7d0ff]",
          active && "chunk-active",
        )}
      >
        {chunk.text}
      </h2>
    );
  }

  const translation = chunk.translation ?? streamingText;
  const original = (
    <p className="font-serif text-[15px] leading-7 text-fg/90">{highlightTerms(chunk.text, matcher)}</p>
  );
  const translated = (
    <div className="text-[15px] leading-7 text-fg">
      {translation ? (
        <p className={clsx(!chunk.translation && "caret")}>{translation}</p>
      ) : error ? (
        <button onClick={() => onVisible(chunk)} className="flex items-center gap-1.5 text-sm text-red-300 hover:underline">
          <RotateCw className="h-3.5 w-3.5" /> 翻译失败：{error}，点击重试
        </button>
      ) : (
        <div className="space-y-2 pt-1.5">
          <div className="skeleton h-3.5 w-full" />
          <div className="skeleton h-3.5 w-11/12" />
          <div className="skeleton h-3.5 w-2/3" />
        </div>
      )}
    </div>
  );

  return (
    <div
      ref={ref}
      id={`chunk-${chunk.ref}`}
      data-ref={chunk.ref}
      className={clsx(
        "group scroll-mt-40 relative rounded-xl border border-transparent px-3 py-3 transition-colors duration-500",
        active ? "chunk-active" : "hover:bg-white/[0.02]",
        mode === "bilingual" && "grid gap-x-8 gap-y-2 md:grid-cols-2",
      )}
    >
      <span className="absolute -left-1 top-3 -translate-x-full pr-2 text-[10px] text-faint opacity-0 transition group-hover:opacity-100 max-xl:hidden">
        {chunk.ref} · P{chunk.page}
      </span>
      {mode !== "translation" && original}
      {mode !== "original" && translated}
    </div>
  );
});

/** 把原文中的术语包成带释义浮层的标记 */
function highlightTerms(text: string, { regex, byKey }: TermMatcher): ReactNode {
  if (!regex) return text;
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(regex)) {
    const term = byKey.get(m[0].toLowerCase());
    if (!term || m.index === undefined) continue;
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(
      <span key={m.index} className="term group/term relative">
        {m[0]}
        <span className="glass pointer-events-none absolute bottom-full left-0 z-30 mb-2 hidden w-64 rounded-lg p-3 font-sans text-xs leading-relaxed shadow-xl group-hover/term:block">
          <span className="block text-sm font-medium text-accent-2">{term.translation}</span>
          <span className="mt-1 block text-muted">{term.explanation}</span>
        </span>
      </span>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function buildTermMatcher(glossary: GlossaryTerm[] | undefined): TermMatcher {
  const byKey = new Map<string, GlossaryTerm>();
  if (!glossary?.length) return { regex: null, byKey };
  for (const t of glossary) byKey.set(t.term.toLowerCase(), t);
  const escaped = [...byKey.keys()]
    .sort((a, b) => b.length - a.length)
    .map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return { regex: new RegExp(`\\b(${escaped.join("|")})\\b`, "gi"), byKey };
}
