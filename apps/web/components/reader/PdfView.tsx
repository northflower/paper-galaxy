"use client";

import clsx from "clsx";
import type { RenderTask } from "pdfjs-dist";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { closePdf, openPdf, type PdfHandle } from "@/lib/pdf/document";
import type { Chunk, ChunkBox } from "@/lib/types";
import { useReader } from "@/stores/reader";
import { ChunkRow, type TermMatcher } from "./ChunkRow";

interface Props {
  paperId: string;
  file: Blob;
  chunks: Chunk[];
  mode: "original" | "bilingual";
  activeSet: Set<string>;
  night: boolean;
  matcher: TermMatcher;
  translator: {
    streaming: Record<string, string>;
    failed: Record<string, string>;
    request: (chunk: Chunk) => void;
  };
}

interface Mark {
  ref: string;
  box: ChunkBox;
}

/**
 * 原版 PDF 阅读：按页渲染原始排版（含图表、公式），叠加可选中的文字层与段落高亮。
 * 对照模式下每页右侧是该页段落的译文，悬停或点击任一侧，另一侧同步高亮。
 */
export function PdfView({ paperId, file, chunks, mode, activeSet, night, matcher, translator }: Props) {
  const [handle, setHandle] = useState<PdfHandle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const focus = useReader((s) => s.focus);

  useEffect(() => {
    let alive = true;
    openPdf(paperId, file)
      .then((h) => alive && setHandle(h))
      .catch((err) => alive && setError((err as Error).message));
    return () => {
      alive = false;
      closePdf(paperId);
    };
  }, [paperId, file]);

  // 按页归集：段落的所有矩形用于高亮，段落本身归到它开始的那一页显示译文
  const { marksByPage, chunksByPage } = useMemo(() => {
    const marks = new Map<number, Mark[]>();
    const byPage = new Map<number, Chunk[]>();
    for (const c of chunks) {
      for (const box of c.boxes ?? []) {
        if (!marks.has(box.page)) marks.set(box.page, []);
        marks.get(box.page)!.push({ ref: c.ref, box });
      }
      const page = c.boxes?.[0]?.page ?? c.page;
      if (!byPage.has(page)) byPage.set(page, []);
      byPage.get(page)!.push(c);
    }
    return { marksByPage: marks, chunksByPage: byPage };
  }, [chunks]);

  // 点击页面上的段落：高亮它，并把右侧对应译文滚入视野
  const pick = useCallback(
    (ref: string) => {
      focus([ref], { scroll: false });
      document.getElementById(`chunk-${ref}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    },
    [focus],
  );

  if (error) return <p className="py-20 text-center text-sm text-red-300">PDF 加载失败：{error}</p>;
  if (!handle) {
    return (
      <div className="mx-auto w-full max-w-[860px]">
        <div className="skeleton aspect-[1/1.3] w-full rounded-sm" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {handle.sizes.map((size, i) => {
        const page = i + 1;
        const pageChunks = chunksByPage.get(page) ?? [];
        const pageView = (
          <PdfPage
            handle={handle}
            page={page}
            size={size}
            marks={marksByPage.get(page) ?? []}
            activeSet={activeSet}
            hovered={hovered}
            night={night}
            onPick={mode === "bilingual" ? pick : undefined}
          />
        );
        if (mode === "original") {
          return (
            <div key={page} className="mx-auto w-full max-w-[920px]">
              {pageView}
            </div>
          );
        }
        return (
          <div key={page} className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            <div className="lg:sticky lg:top-[76px]">{pageView}</div>
            <div className="min-w-0 space-y-0.5" onMouseLeave={() => setHovered(null)}>
              {pageChunks
                .filter((c) => c.kind !== "reference")
                .map((c) => (
                  <div key={c.id} onMouseEnter={() => setHovered(c.ref)}>
                    <ChunkRow
                      chunk={c}
                      mode="translation"
                      active={activeSet.has(c.ref) || hovered === c.ref}
                      streamingText={translator.streaming[c.id]}
                      error={translator.failed[c.id]}
                      matcher={matcher}
                      onVisible={translator.request}
                      compact
                    />
                  </div>
                ))}
              {!pageChunks.some((c) => c.kind === "paragraph") && (
                <p className="px-3 py-2 text-xs text-faint">本页没有可翻译的正文（图表、参考文献等）</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

interface PageProps {
  handle: PdfHandle;
  page: number;
  size: { width: number; height: number };
  marks: Mark[];
  activeSet: Set<string>;
  hovered: string | null;
  night: boolean;
  onPick?: (ref: string) => void;
}

/** 单页：只在接近视口时渲染画布与文字层，离开后释放，长论文也不会占满内存 */
const PdfPage = memo(function PdfPage({ handle, page, size, marks, activeSet, hovered, night, onPick }: PageProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  const [visible, setVisible] = useState(false);

  // 宽度随布局变化，缩放比 = 显示宽度 / PDF 页宽
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    let timer = 0;
    const ro = new ResizeObserver(([entry]) => {
      clearTimeout(timer);
      const w = entry.contentRect.width;
      timer = window.setTimeout(() => setScale(w / size.width), scale ? 150 : 0);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.width]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { rootMargin: "1200px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const textEl = textRef.current;
    if (!canvas || !textEl || !scale) return;
    if (!visible) {
      // 释放离屏页面的位图内存
      canvas.width = 0;
      canvas.height = 0;
      textEl.replaceChildren();
      return;
    }
    let cancelled = false;
    let task: RenderTask | null = null;
    void (async () => {
      const pdfPage = await handle.doc.getPage(page);
      if (cancelled) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const viewport = pdfPage.getViewport({ scale });
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      task = pdfPage.render({
        canvasContext: canvas.getContext("2d")!,
        viewport,
        transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
      });
      try {
        await task.promise;
      } catch {
        return;
      }
      if (cancelled) return;
      const { TextLayer } = await import("pdfjs-dist");
      textEl.replaceChildren();
      await new TextLayer({ textContentSource: pdfPage.streamTextContent(), container: textEl, viewport }).render();
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [handle, page, scale, visible]);

  const pickAt = (e: React.PointerEvent) => {
    if (!onPick || window.getSelection()?.toString().trim()) return;
    const rect = wrapRef.current!.getBoundingClientRect();
    const x = (e.clientX - rect.left) / scale;
    const y = (e.clientY - rect.top) / scale;
    const hit = marks.find(({ box }) => x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h);
    if (hit) onPick(hit.ref);
  };

  const seen = new Set<string>();
  return (
    <figure className="m-0">
      <div
        ref={wrapRef}
        onPointerUp={pickAt}
        className={clsx(
          "relative w-full overflow-hidden rounded-[3px] shadow-[0_0_0_1px_rgba(255,255,255,0.06),0_24px_64px_-24px_rgba(0,0,0,0.9)]",
          night ? "bg-[#161719]" : "bg-white",
        )}
        style={{ aspectRatio: `${size.width} / ${size.height}`, ["--scale-factor" as string]: scale }}
      >
        <canvas
          ref={canvasRef}
          className="absolute inset-0 h-full w-full"
          style={night ? { filter: "invert(0.88) hue-rotate(180deg) contrast(0.95)" } : undefined}
        />
        {scale > 0 &&
          marks.map(({ ref, box }, i) => {
            const on = activeSet.has(ref);
            const hover = hovered === ref;
            // 每个段落的首个矩形放一个滚动锚点，供脉络、引用、检索结果跳转
            const anchor = !seen.has(ref) && seen.add(ref);
            return (
              <div
                key={`${ref}-${i}`}
                id={anchor ? `anchor-${ref}` : undefined}
                className={clsx(
                  "pointer-events-none absolute scroll-mt-28 rounded-[2px] transition-colors duration-300",
                  on ? "bg-[rgba(99,115,255,0.16)] ring-1 ring-[rgba(99,115,255,0.55)]" : hover ? "bg-[rgba(99,115,255,0.09)]" : "",
                )}
                style={{ left: box.x * scale, top: box.y * scale, width: box.w * scale, height: box.h * scale }}
              />
            );
          })}
        <div ref={textRef} className="textLayer" />
      </div>
      <figcaption className="mt-2 text-center font-mono text-[11px] text-faint">{page}</figcaption>
    </figure>
  );
});
