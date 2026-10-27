"use client";

import clsx from "clsx";
import type { RenderTask } from "pdfjs-dist";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { closePdf, openPdf, type PdfHandle } from "@/lib/pdf/document";
import type { Chunk, ChunkBox } from "@/lib/types";
import type { ViewMode } from "@/stores/reader";
import { useReader } from "@/stores/reader";

export interface Translator {
  streaming: Record<string, string>;
  failed: Record<string, string>;
  request: (chunk: Chunk) => void;
}

interface Props {
  paperId: string;
  file: Blob;
  chunks: Chunk[];
  mode: ViewMode;
  activeSet: Set<string>;
  night: boolean;
  translator: Translator;
  /** 页面宽度相对阅读区的比例；大于 1 时阅读区横向滚动 */
  zoom: number;
}

/** 段落在某一页上的一块矩形；boxIndex 用于把译文按面积分配到跨栏、跨页的各块 */
interface Mark {
  chunk: Chunk;
  box: ChunkBox;
  boxIndex: number;
}

// 夜间纸张：invert(0.9) 后白纸变为 #1a1a1a，遮罩与文字颜色需与之一致
const PAPER = {
  day: { bg: "#ffffff", text: "#1d1d1f", filter: undefined },
  night: { bg: "#1a1a1a", text: "#e2e3e8", filter: "invert(0.9) hue-rotate(180deg)" },
};

/**
 * 原版 PDF 阅读：按页渲染原始排版（含图表、公式）。
 * 译文页沿用原页面的画面，把正文段落的位置替换为译文，图表、公式、表格保持原样，
 * 与原文页逐段对应；悬停或点击任一侧，另一侧同步高亮。
 */
export function PdfView({ paperId, file, chunks, mode, activeSet, night, translator, zoom }: Props) {
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

  const marksByPage = useMemo(() => {
    const marks = new Map<number, Mark[]>();
    for (const chunk of chunks) {
      chunk.boxes?.forEach((box, boxIndex) => {
        if (!marks.has(box.page)) marks.set(box.page, []);
        marks.get(box.page)!.push({ chunk, box, boxIndex });
      });
    }
    return marks;
  }, [chunks]);

  // 点击任一侧的段落：两侧同时高亮
  const pick = useCallback((ref: string) => focus([ref], { scroll: false }), [focus]);

  if (error) return <p className="py-20 text-center text-sm text-red-300">PDF 加载失败：{error}</p>;
  if (!handle) {
    return (
      <div className="mx-auto w-full max-w-[1100px]">
        <div className="skeleton aspect-[1/1.3] w-full rounded-sm" />
      </div>
    );
  }

  const paper = night ? PAPER.night : PAPER.day;
  return (
    <div
      className="mx-auto space-y-6"
      // 单页模式下 100% 时页面不宜过宽，限制在约 1100px 以内，再按缩放比例放大
      style={{ width: `${zoom * 100}%`, maxWidth: mode === "bilingual" ? undefined : zoom * 1100 }}
      onMouseLeave={() => setHovered(null)}
    >
      {handle.sizes.map((size, i) => {
        const page = i + 1;
        const common = {
          handle,
          page,
          size,
          marks: marksByPage.get(page) ?? [],
          activeSet,
          hovered,
          paper,
          onPick: pick,
          onHover: setHovered,
        };
        return (
          <div
            key={page}
            className={clsx(mode === "bilingual" ? "grid items-start gap-3 lg:grid-cols-2" : "w-full")}
          >
            {mode !== "translation" && <PdfPage {...common} variant="original" />}
            {mode !== "original" && <PdfPage {...common} variant="translated" translator={translator} />}
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
  paper: (typeof PAPER)["day"] | (typeof PAPER)["night"];
  variant: "original" | "translated";
  translator?: Translator;
  onPick: (ref: string) => void;
  onHover: (ref: string | null) => void;
}

/** 单页：只在接近视口时渲染，离开后释放画布，长论文也不会占满内存 */
const PdfPage = memo(function PdfPage({
  handle,
  page,
  size,
  marks,
  activeSet,
  hovered,
  paper,
  variant,
  translator,
  onPick,
  onHover,
}: PageProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  const [visible, setVisible] = useState(false);
  const translated = variant === "translated";

  // 宽度随布局变化，缩放比 = 显示宽度 / PDF 页宽
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    let timer = 0;
    let first = true;
    const ro = new ResizeObserver(([entry]) => {
      clearTimeout(timer);
      const w = entry.contentRect.width;
      timer = window.setTimeout(() => setScale(w / size.width), first ? 0 : 150);
      first = false;
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      clearTimeout(timer);
    };
  }, [size.width]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { rootMargin: "1200px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // 译文页进入视野时，请求本页所有正文段落的翻译（已翻译或已在队列中的会自动跳过）
  const request = translator?.request;
  useEffect(() => {
    if (!translated || !visible || !request) return;
    for (const m of marks) if (translatable(m.chunk)) request(m.chunk);
  }, [translated, visible, marks, request]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const textEl = textRef.current;
    if (!canvas || !scale) return;
    if (!visible) {
      // 释放离屏页面的位图内存
      canvas.width = 0;
      canvas.height = 0;
      textEl?.replaceChildren();
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
      if (cancelled || !textEl) return;
      const { TextLayer } = await import("pdfjs-dist");
      textEl.replaceChildren();
      await new TextLayer({ textContentSource: pdfPage.streamTextContent(), container: textEl, viewport }).render();
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [handle, page, scale, visible]);

  // 在原文页上点击段落（且没有在选文字）时，定位该段
  const pickAt = (e: React.PointerEvent) => {
    if (translated || window.getSelection()?.toString().trim()) return;
    const rect = wrapRef.current!.getBoundingClientRect();
    const x = (e.clientX - rect.left) / scale;
    const y = (e.clientY - rect.top) / scale;
    const hit = marks.find(({ box }) => x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h);
    if (hit) onPick(hit.chunk.ref);
  };

  const seen = new Set<string>();
  return (
    <figure className="m-0 min-w-0">
      <div
        ref={wrapRef}
        onPointerUp={pickAt}
        className="relative w-full overflow-hidden rounded-[3px] shadow-[0_0_0_1px_rgba(255,255,255,0.06),0_24px_64px_-24px_rgba(0,0,0,0.9)]"
        style={{ aspectRatio: `${size.width} / ${size.height}`, background: paper.bg, ["--scale-factor" as string]: scale }}
      >
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" style={{ filter: paper.filter }} />

        {scale > 0 &&
          marks.map((m, i) => {
            const ref = m.chunk.ref;
            const on = activeSet.has(ref);
            const hover = hovered === ref;
            const style = { left: m.box.x * scale, top: m.box.y * scale, width: m.box.w * scale, height: m.box.h * scale };
            const ring = on
              ? "ring-1 ring-[rgba(120,135,255,0.75)] bg-[rgba(99,115,255,0.14)]"
              : hover
                ? "bg-[rgba(99,115,255,0.09)]"
                : "";
            // 原文页上每个段落的首块放一个滚动锚点，供脉络、引用、检索结果跳转
            const anchor = !translated && !seen.has(ref) && seen.add(ref);

            if (translated && translatable(m.chunk) && translator) {
              return (
                <TranslatedBox
                  key={`${ref}-${i}`}
                  mark={m}
                  style={style}
                  scale={scale}
                  paper={paper}
                  translator={translator}
                  className={ring}
                  onHover={onHover}
                  onPick={onPick}
                />
              );
            }
            return (
              <div
                key={`${ref}-${i}`}
                id={anchor ? `anchor-${ref}` : undefined}
                onMouseEnter={() => onHover(ref)}
                className={clsx("absolute scroll-mt-28 rounded-[2px] transition-colors duration-300", ring, translated && "pointer-events-auto")}
                style={{ ...style, pointerEvents: translated ? undefined : "none" }}
              />
            );
          })}

        {!translated && <div ref={textRef} className="textLayer" onMouseMove={(e) => hoverAt(e, wrapRef, scale, marks, onHover)} />}
      </div>
      <figcaption className="mt-2 text-center font-mono text-[11px] text-faint">
        {page}
        {translated && <span className="ml-1.5 font-sans">· 译</span>}
      </figcaption>
    </figure>
  );
});

function hoverAt(
  e: React.MouseEvent,
  wrapRef: React.RefObject<HTMLDivElement | null>,
  scale: number,
  marks: Mark[],
  onHover: (ref: string | null) => void,
) {
  const rect = wrapRef.current?.getBoundingClientRect();
  if (!rect || !scale) return;
  const x = (e.clientX - rect.left) / scale;
  const y = (e.clientY - rect.top) / scale;
  const hit = marks.find(({ box }) => x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h);
  onHover(hit?.chunk.ref ?? null);
}

/**
 * 译文块：用纸张底色盖住原文段落，在同一位置排入译文，并自动缩放字号填满原段落的区域。
 * 段落跨栏、跨页时，译文按各块面积比例切分。
 */
function TranslatedBox({
  mark,
  style,
  scale,
  paper,
  translator,
  className,
  onHover,
  onPick,
}: {
  mark: Mark;
  style: React.CSSProperties;
  scale: number;
  paper: PageProps["paper"];
  translator: Translator;
  className: string;
  onHover: (ref: string | null) => void;
  onPick: (ref: string) => void;
}) {
  const { chunk, boxIndex } = mark;
  const full = chunk.translation ?? translator.streaming[chunk.id];
  const failed = translator.failed[chunk.id];
  const text = full ? sliceForBox(full, chunk.boxes!, boxIndex) : "";
  const textRef = useRef<HTMLDivElement>(null);

  // 二分查找能放下全部译文的最大字号；上限约等于原文正文字号
  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el || !text) return;
    let lo = 3;
    let hi = 10.5 * scale;
    for (let k = 0; k < 8; k++) {
      const mid = (lo + hi) / 2;
      el.style.fontSize = `${mid}px`;
      if (el.scrollHeight <= el.clientHeight + 1) lo = mid;
      else hi = mid;
    }
    el.style.fontSize = `${lo}px`;
  }, [text, scale, style.width, style.height]);

  return (
    <div
      id={boxIndex === 0 ? `tr-${chunk.ref}` : undefined}
      onMouseEnter={() => onHover(chunk.ref)}
      onClick={() => onPick(chunk.ref)}
      className={clsx("absolute cursor-pointer overflow-hidden rounded-[2px] transition-colors duration-300", className)}
      style={{ ...style, background: paper.bg }}
    >
      {text ? (
        <div
          ref={textRef}
          className={clsx("h-full w-full text-justify", !chunk.translation && "caret")}
          style={{ color: paper.text, lineHeight: 1.42, fontFamily: "var(--font-sans)" }}
        >
          {text}
        </div>
      ) : failed ? (
        <button
          onClick={(e) => {
            e.stopPropagation();
            translator.request(chunk);
          }}
          className="h-full w-full text-[11px] text-red-400 hover:underline"
        >
          翻译失败，点击重试
        </button>
      ) : (
        <div className="flex h-full flex-col justify-start gap-[6px] p-[2px] opacity-60">
          {Array.from({ length: Math.max(1, Math.min(8, Math.floor(((style.height as number) || 0) / (12 * scale)))) }, (_, k) => (
            <div key={k} className="skeleton h-[40%] max-h-[8px] min-h-[3px]" style={{ width: k % 3 === 2 ? "70%" : "100%" }} />
          ))}
        </div>
      )}
    </div>
  );
}

/** 按矩形面积比例，把整段译文切给第 boxIndex 块 */
function sliceForBox(text: string, boxes: ChunkBox[], boxIndex: number) {
  if (boxes.length === 1) return text;
  const areas = boxes.map((b) => b.w * b.h);
  const total = areas.reduce((a, b) => a + b, 0);
  let start = 0;
  for (let i = 0; i < boxIndex; i++) start += areas[i] / total;
  const end = start + areas[boxIndex] / total;
  return text.slice(Math.round(start * text.length), Math.round(end * text.length));
}

/**
 * 译文页只替换正文段落：表格被解析成段落时多为数字与缩写，首页标题前的作者、单位信息也不翻译，
 * 这些区域保留原样
 */
function translatable(chunk: Chunk) {
  if (chunk.kind !== "paragraph") return false;
  if (chunk.page === 1 && !chunk.section && chunk.text.length < 300) return false;
  const letters = chunk.text.match(/[a-z]/gi)?.length ?? 0;
  return letters / chunk.text.length > 0.6;
}
