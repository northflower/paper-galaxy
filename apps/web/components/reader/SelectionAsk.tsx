"use client";

import { MessageCircleQuestion } from "lucide-react";
import { useEffect, useState, type RefObject } from "react";
import { useReader } from "@/stores/reader";

/** 划词提问：在正文中选中文字后，浮现“问 AI”按钮 */
export function SelectionAsk({ containerRef }: { containerRef: RefObject<HTMLElement | null> }) {
  const [sel, setSel] = useState<{ text: string; x: number; y: number } | null>(null);
  const ask = useReader((s) => s.ask);

  useEffect(() => {
    const onUp = () => {
      // 等待浏览器更新选区
      setTimeout(() => {
        const s = window.getSelection();
        const text = s?.toString().trim() ?? "";
        const container = containerRef.current;
        if (!s || !text || text.length < 3 || text.length > 800 || !container?.contains(s.anchorNode)) {
          setSel(null);
          return;
        }
        const rect = s.getRangeAt(0).getBoundingClientRect();
        setSel({ text, x: rect.left + rect.width / 2, y: rect.top });
      }, 0);
    };
    const onScroll = () => setSel(null);
    document.addEventListener("pointerup", onUp);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      document.removeEventListener("pointerup", onUp);
      window.removeEventListener("scroll", onScroll);
    };
  }, [containerRef]);

  if (!sel) return null;
  return (
    <button
      onPointerUp={(e) => e.stopPropagation()}
      onClick={() => {
        ask(`请解释论文中的这段内容：“${sel.text}”`);
        window.getSelection()?.removeAllRanges();
        setSel(null);
      }}
      style={{ left: sel.x, top: sel.y - 44 }}
      className="glass fixed z-50 flex -translate-x-1/2 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-accent shadow-xl"
    >
      <MessageCircleQuestion className="h-4 w-4" /> 问 AI
    </button>
  );
}
