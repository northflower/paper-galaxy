"use client";

import { Languages, Loader2, MessageCircleQuestion, X } from "lucide-react";
import { useEffect, useRef, useState, type RefObject } from "react";
import { termsFor } from "@/lib/hooks/useTranslator";
import { postStream, readTextStream } from "@/lib/stream";
import type { GlossaryTerm } from "@/lib/types";
import { useReader } from "@/stores/reader";

interface Selection {
  text: string;
  x: number;
  top: number;
  bottom: number;
}

/** 划词工具条：选中正文后可直接翻译（遵循本文术语表），或交给 AI 解释 */
export function SelectionToolbar({ containerRef, glossary }: { containerRef: RefObject<HTMLElement | null>; glossary: GlossaryTerm[] }) {
  const [sel, setSel] = useState<Selection | null>(null);
  const [translation, setTranslation] = useState<{ text: string; done: boolean; error?: string } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const ask = useReader((s) => s.ask);

  const close = () => {
    abortRef.current?.abort();
    setSel(null);
    setTranslation(null);
  };

  useEffect(() => {
    const onUp = (e: PointerEvent) => {
      if (toolbarRef.current?.contains(e.target as Node)) return;
      // 等待浏览器更新选区
      setTimeout(() => {
        const s = window.getSelection();
        const text = s?.toString().trim() ?? "";
        if (!s || !text || text.length < 2 || text.length > 1500 || !containerRef.current?.contains(s.anchorNode)) {
          close();
          return;
        }
        const rect = s.getRangeAt(0).getBoundingClientRect();
        abortRef.current?.abort();
        setTranslation(null);
        setSel({ text, x: rect.left + rect.width / 2, top: rect.top, bottom: rect.bottom });
      }, 0);
    };
    const onScroll = () => close();
    document.addEventListener("pointerup", onUp);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      document.removeEventListener("pointerup", onUp);
      window.removeEventListener("scroll", onScroll);
    };
  }, [containerRef]);

  if (!sel) return null;

  const translate = async () => {
    const controller = new AbortController();
    abortRef.current = controller;
    setTranslation({ text: "", done: false });
    try {
      const res = await postStream(
        "/api/translate",
        { text: sel.text, section: "", terms: termsFor(sel.text, glossary) },
        controller.signal,
      );
      const full = await readTextStream(res, (t) => setTranslation({ text: t, done: false }), controller.signal);
      setTranslation({ text: full.trim(), done: true });
    } catch (err) {
      if (!controller.signal.aborted) setTranslation({ text: "", done: true, error: (err as Error).message });
    }
  };

  // 选区靠近顶部时，工具条放到选区下方
  const below = sel.top < 140;
  const width = Math.min(380, window.innerWidth - 24);
  const left = Math.min(Math.max(sel.x, width / 2 + 12), window.innerWidth - width / 2 - 12);

  return (
    <div
      ref={toolbarRef}
      style={{ left, top: below ? sel.bottom + 10 : undefined, bottom: below ? undefined : window.innerHeight - sel.top + 10 }}
      className="rise fixed z-50 flex -translate-x-1/2 flex-col items-center gap-2"
    >
      {translation && !below && <TranslationCard translation={translation} width={width} onClose={close} />}
      <div className="glass flex items-center gap-0.5 rounded-xl p-1 text-[13px] shadow-[0_16px_48px_-12px_rgba(0,0,0,0.8)]">
        <button
          onClick={translate}
          className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-fg/90 transition hover:bg-white/[0.07]"
        >
          <Languages className="h-3.5 w-3.5 text-accent" /> 翻译
        </button>
        <span className="h-4 w-px bg-line" />
        <button
          onClick={() => {
            ask(`请解释论文中的这段内容：“${sel.text}”`);
            window.getSelection()?.removeAllRanges();
            close();
          }}
          className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-fg/90 transition hover:bg-white/[0.07]"
        >
          <MessageCircleQuestion className="h-3.5 w-3.5 text-accent" /> 解释
        </button>
      </div>
      {translation && below && <TranslationCard translation={translation} width={width} onClose={close} />}
    </div>
  );
}

function TranslationCard({
  translation,
  width,
  onClose,
}: {
  translation: { text: string; done: boolean; error?: string };
  width: number;
  onClose: () => void;
}) {
  return (
    <div style={{ width }} className="glass relative rounded-xl p-4 pr-9 text-[14px] leading-relaxed shadow-[0_16px_48px_-12px_rgba(0,0,0,0.8)]">
      <button aria-label="关闭" onClick={onClose} className="absolute right-2.5 top-2.5 text-faint hover:text-fg">
        <X className="h-3.5 w-3.5" />
      </button>
      {translation.error ? (
        <span className="text-red-300">{translation.error}</span>
      ) : translation.text ? (
        <span className={translation.done ? "" : "caret"}>{translation.text}</span>
      ) : (
        <span className="flex items-center gap-2 text-faint">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> 翻译中…
        </span>
      )}
    </div>
  );
}
