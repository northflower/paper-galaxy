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
  /** 同一段落被拆成多块（过长段落按句切分）时共用同一区域，group 为全部片段，chunk 为首个片段 */
  chunk: Chunk;
  group: Chunk[];
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
    // 位置完全相同的片段合并为一组，避免多个片段的译文叠在同一个框里互相覆盖
    const groups = new Map<string, Chunk[]>();
    for (const chunk of chunks) {
      if (!chunk.boxes?.length) continue;
      const key = JSON.stringify(chunk.boxes);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(chunk);
    }
    const marks = new Map<number, Mark[]>();
    for (const group of groups.values()) {
      const chunk = group[0];
      chunk.boxes!.forEach((box, boxIndex) => {
        if (!marks.has(box.page)) marks.set(box.page, []);
        marks.get(box.page)!.push({ chunk, group, box, boxIndex });
      });
    }
    return marks;
  }, [chunks]);

  // 点击任一侧的段落：两侧同时高亮
  // 再次点击已选中的段落或点击空白处，取消选中
  const pick = useCallback(
    (refs: string[] | null) => {
      if (!refs || refs.some((r) => activeSet.has(r))) focus([], { scroll: false });
      else focus(refs, { scroll: false });
    },
    [focus, activeSet],
  );

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
      id="pdf-pages"
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
  onPick: (refs: string[] | null) => void;
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
  // scale 随布局即时更新，叠加层（段落框、译文、文字层）立刻跟上；
  // renderScale 等缩放停下后再更新，画布才按新分辨率重绘，中途用旧位图拉伸过渡
  const [scale, setScale] = useState(0);
  const [renderScale, setRenderScale] = useState(0);
  const [visible, setVisible] = useState(false);
  const translated = variant === "translated";
  const regionMode = useReader((st) => st.regionMode);

  // 宽度随布局变化，缩放比 = 显示宽度 / PDF 页宽
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setScale(entry.contentRect.width / size.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [size.width]);

  useEffect(() => {
    if (!scale) return;
    // 首次立即渲染；之后缩放停止 180ms 再重绘
    const timer = window.setTimeout(() => setRenderScale(scale), renderScale ? 180 : 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scale]);

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
    for (const m of marks) if (translatable(m.chunk)) m.group.forEach(request);
  }, [translated, visible, marks, request]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const textEl = textRef.current;
    if (!canvas || !renderScale) return;
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
      const viewport = pdfPage.getViewport({ scale: renderScale });
      // 先画到离屏画布，完成后一次性拷贝到可见画布：
      // 可见画布始终是一帧完整的画面，不会出现清空闪烁或多次渲染交错的乱码
      const offscreen = document.createElement("canvas");
      offscreen.width = Math.floor(viewport.width * dpr);
      offscreen.height = Math.floor(viewport.height * dpr);
      task = pdfPage.render({
        canvasContext: offscreen.getContext("2d")!,
        viewport,
        transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
      });
      try {
        await task.promise;
      } catch {
        return;
      }
      if (cancelled) return;
      canvas.width = offscreen.width;
      canvas.height = offscreen.height;
      canvas.getContext("2d")!.drawImage(offscreen, 0, 0);
      if (!textEl) return;
      // 文字层用 --scale-factor 随缩放即时调整，这里按新尺寸重建一次以保证精度
      const { TextLayer } = await import("pdfjs-dist");
      const fresh = document.createElement("div");
      await new TextLayer({ textContentSource: await pdfPage.getTextContent(), container: fresh, viewport }).render();
      if (cancelled) return;
      textEl.replaceChildren(...fresh.childNodes);
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [handle, page, renderScale, visible]);

  // 在原文页上点击段落（且没有在选文字）时，定位该段
  const pickAt = (e: React.PointerEvent) => {
    if (window.getSelection()?.toString().trim()) return;
    // 译文页：点在译文块上由块自己处理，点在空白处取消选中
    if (translated) {
      if (!(e.target as HTMLElement).closest("[data-tr]")) onPick(null);
      return;
    }
    const rect = wrapRef.current!.getBoundingClientRect();
    const x = (e.clientX - rect.left) / scale;
    const y = (e.clientY - rect.top) / scale;
    const hit = marks.find(({ box }) => x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h);
    onPick(hit ? hit.group.map((c) => c.ref) : null);
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
            const on = m.group.some((c) => activeSet.has(c.ref));
            const hover = hovered === ref;
            // 用百分比定位：页面尺寸变化时叠加层与画布始终对齐
            const style = {
              left: `${(m.box.x / size.width) * 100}%`,
              top: `${(m.box.y / size.height) * 100}%`,
              width: `${(m.box.w / size.width) * 100}%`,
              height: `${(m.box.h / size.height) * 100}%`,
            };
            const ring = on
              ? "ring-1 ring-[rgba(120,135,255,0.75)] bg-[rgba(99,115,255,0.14)]"
              : hover
                ? "bg-[rgba(99,115,255,0.09)]"
                : "";
            // 原文页上每个段落的首块放一个滚动锚点，供脉络、引用、检索结果跳转
            const anchor = !translated && !seen.has(ref) && seen.add(ref);
            // 同组其余片段也需要锚点（问答引用可能指向任一片段）
            const extraAnchors = anchor
              ? m.group.slice(1).map((c) => (
                  <div key={c.ref} id={`anchor-${c.ref}`} className="pointer-events-none absolute scroll-mt-28" style={style} />
                ))
              : null;

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
              <span key={`${ref}-${i}`} className="contents">
                <div
                  id={anchor ? `anchor-${ref}` : undefined}
                  onMouseEnter={() => onHover(ref)}
                  className={clsx("absolute scroll-mt-28 rounded-[2px] transition-colors duration-300", ring)}
                  style={{ ...style, pointerEvents: translated ? undefined : "none" }}
                />
                {extraAnchors}
              </span>
            );
          })}

        {!translated && <div ref={textRef} className="textLayer" onMouseMove={(e) => hoverAt(e, wrapRef, scale, marks, onHover)} />}
        {regionMode && scale > 0 && <RegionSelector canvasRef={canvasRef} scale={scale} page={page} marks={marks} />}
      </div>
      <figcaption className="mt-2 text-center font-mono text-[11px] text-faint">
        {page}
        {translated && <span className="ml-1.5 font-sans">· 译</span>}
      </figcaption>
    </figure>
  );
});

/**
 * 框选：在页面上拖出矩形，从画布截取该区域（画布像素是原始颜色，不受夜间反色影响），
 * 连同与之重叠的原文段落一起交给问答面板，由视觉模型讲解
 */
function RegionSelector({
  canvasRef,
  scale,
  page,
  marks,
}: {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  scale: number;
  page: number;
  marks: Mark[];
}) {
  const [rect, setRect] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const askVision = useReader((s) => s.askVision);
  const layerRef = useRef<HTMLDivElement>(null);

  const point = (e: React.PointerEvent) => {
    const r = layerRef.current!.getBoundingClientRect();
    return { x: Math.min(Math.max(e.clientX - r.left, 0), r.width), y: Math.min(Math.max(e.clientY - r.top, 0), r.height) };
  };

  const finish = () => {
    const canvas = canvasRef.current;
    if (!rect || !canvas) return setRect(null);
    const x = Math.min(rect.x0, rect.x1);
    const y = Math.min(rect.y0, rect.y1);
    const w = Math.abs(rect.x1 - rect.x0);
    const h = Math.abs(rect.y1 - rect.y0);
    setRect(null);
    if (w < 16 || h < 16 || !canvas.width) return;
    // CSS 像素 → 画布像素，输出长边不超过 1280px
    const ratio = canvas.width / canvas.clientWidth;
    const fit = Math.min(1, 1280 / Math.max(w * ratio, h * ratio));
    const out = document.createElement("canvas");
    out.width = Math.round(w * ratio * fit);
    out.height = Math.round(h * ratio * fit);
    out.getContext("2d")!.drawImage(canvas, x * ratio, y * ratio, w * ratio, h * ratio, 0, 0, out.width, out.height);
    // 与框选区域重叠的段落作为上下文
    const bx = { x: x / scale, y: y / scale, w: w / scale, h: h / scale };
    const seen = new Set<string>();
    const context = marks
      .filter(({ box }) => box.x < bx.x + bx.w && box.x + box.w > bx.x && box.y < bx.y + bx.h + 40 && box.y + box.h > bx.y - 40)
      .filter(({ chunk }) => !seen.has(chunk.ref) && seen.add(chunk.ref))
      .map(({ chunk }) => chunk.text)
      .join("\n");
    askVision({ image: out.toDataURL("image/jpeg", 0.9), page, context });
  };

  const sel = rect && {
    left: Math.min(rect.x0, rect.x1),
    top: Math.min(rect.y0, rect.y1),
    width: Math.abs(rect.x1 - rect.x0),
    height: Math.abs(rect.y1 - rect.y0),
  };
  return (
    <div
      ref={layerRef}
      className="absolute inset-0 z-20 cursor-crosshair bg-[rgba(99,115,255,0.04)]"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        const p = point(e);
        setRect({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
      }}
      onPointerMove={(e) => {
        if (!rect) return;
        const p = point(e);
        setRect((r) => r && { ...r, x1: p.x, y1: p.y });
      }}
      onPointerUp={finish}
    >
      {sel && (
        <div
          className="absolute rounded-sm border border-[rgba(140,155,255,0.95)] bg-[rgba(99,115,255,0.12)] shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]"
          style={sel}
        />
      )}
    </div>
  );
}

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
  style: { left: string; top: string; width: string; height: string };
  scale: number;
  paper: PageProps["paper"];
  translator: Translator;
  className: string;
  onHover: (ref: string | null) => void;
  onPick: (refs: string[] | null) => void;
}) {
  const { chunk, group, boxIndex } = mark;
  // 拼接同组所有片段的译文（已完成的 + 正在流式生成的）
  const parts = group.map((c) => c.translation ?? translator.streaming[c.id] ?? "");
  const full = parts.join("");
  const pending = group.some((c) => !c.translation);
  const failed = group.map((c) => translator.failed[c.id]).find(Boolean);
  const text = full ? sliceForBox(full, chunk.boxes!, boxIndex) : "";
  const textRef = useRef<HTMLDivElement>(null);

  // 二分查找能放下全部译文的最大字号（以 PDF 点为单位，上限约等于正文字号）。
  // 字号写成 var(--scale-factor) 的倍数，缩放时随页面同步缩放，无需重新计算
  const sized = useRef<{ text: string; scale: number } | null>(null);
  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el || !text || !scale) return;
    // 文字没变、只是缩放时跳过（比例不变）；缩放幅度很大时重新拟合一次，修正换行误差
    const last = sized.current;
    if (last && last.text === text && Math.abs(last.scale - scale) / last.scale < 0.35) return;
    let lo = 4;
    let hi = 10.5;
    for (let k = 0; k < 9; k++) {
      const mid = (lo + hi) / 2;
      el.style.fontSize = `${mid * scale}px`;
      if (el.scrollHeight <= el.clientHeight + 1) lo = mid;
      else hi = mid;
    }
    el.style.fontSize = `calc(var(--scale-factor) * ${lo.toFixed(3)}px)`;
    sized.current = { text, scale };
  }, [text, scale]);

  return (
    <div
      id={boxIndex === 0 ? `tr-${chunk.ref}` : undefined}
      data-tr
      onMouseEnter={() => onHover(chunk.ref)}
      onClick={() => onPick(group.map((c) => c.ref))}
      className={clsx("absolute cursor-pointer overflow-hidden rounded-[2px] transition-colors duration-300", className)}
      style={{ ...style, background: paper.bg }}
    >
      {text ? (
        <div
          ref={textRef}
          className={clsx("h-full w-full text-justify", pending && "caret")}
          style={{ color: paper.text, lineHeight: 1.42, fontFamily: "var(--font-sans)" }}
        >
          {text}
        </div>
      ) : failed ? (
        <button
          onClick={(e) => {
            e.stopPropagation();
            group.forEach(translator.request);
          }}
          className="h-full w-full text-[11px] text-red-400 hover:underline"
        >
          翻译失败，点击重试
        </button>
      ) : (
        <div className="flex h-full flex-col justify-start gap-[6px] p-[2px] opacity-60">
          {Array.from({ length: Math.max(1, Math.min(8, Math.floor(mark.box.h / 12))) }, (_, k) => (
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
