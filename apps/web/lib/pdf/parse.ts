import type { Chunk, ChunkKind } from "../types";

/** pdf.js 文本项中解析需要的字段 */
interface RawItem {
  str: string;
  x: number;
  y: number;
  width: number;
  size: number;
}

interface Line {
  text: string;
  x: number;
  y: number;
  size: number;
}

export interface ParsedPdf {
  title: string;
  pageCount: number;
  chunks: Omit<Chunk, "id" | "paperId">[];
}

const MAX_CHUNK = 1400;
// 整行恰好是常见章节名（可带编号）才算标题，避免正文中以 “experiments …” 开头的行被误判
const KNOWN_SECTIONS =
  /^((\d+(\.\d+)*\.?|[IVX]{1,5}\.)\s*)?(abstract|introduction|related work|background|preliminar(y|ies)|method(s|ology)?|approach|experiments?|evaluation|results?|discussion|conclusions?|limitations?|acknowledg(e)?ments?|references|bibliography|appendix)( and [a-z ]{3,30})?$/i;
const NUMBERED_HEADING = /^((\d+(\.\d+){0,3})\.?|[IVX]{1,5}\.|[A-H]\.)\s+[A-Z][^.!?]{1,90}$/;
const REFERENCES = /^(\d+\.?\s*)?(references|bibliography)$/i;

async function loadPdfjs() {
  const pdfjs = await import("pdfjs-dist");
  // worker 由 postinstall 脚本复制到 public 目录
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  return pdfjs;
}

/** 浏览器端解析 PDF：按坐标重建行与段落，自动处理双栏排版 */
export async function parsePdf(file: Blob, onProgress?: (page: number, total: number) => void): Promise<ParsedPdf> {
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;

  const pages: { lines: Line[]; width: number }[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const items: RawItem[] = [];
    for (const it of content.items) {
      if (!("str" in it) || !it.str.trim()) continue;
      const [a, b, , , e, f] = it.transform as number[];
      items.push({ str: it.str, x: e, y: f, width: it.width, size: Math.hypot(a, b) || it.height });
    }
    pages.push({ lines: orderLines(items, viewport.width), width: viewport.width });
    onProgress?.(p, doc.numPages);
  }

  const bodySize = modeFontSize(pages.flatMap((p) => p.lines));
  const title = guessTitle(pages[0]?.lines ?? [], bodySize);
  const chunks = buildChunks(pages, bodySize, title);
  await doc.destroy();
  return { title, pageCount: pages.length, chunks };
}

/**
 * 按阅读顺序输出行。双栏页中，跨越中线的通栏行（标题、摘要、通栏图注）把页面切成若干纵向区段，
 * 每个区段内先读左栏、再读右栏。
 */
function orderLines(items: RawItem[], pageWidth: number): Line[] {
  const mid = pageWidth / 2;
  const isFull = (it: RawItem) => it.x < mid - 10 && it.x + it.width > mid + 10;
  const full = items.filter(isFull);
  const right = items.filter((it) => !isFull(it) && it.x >= mid - 10);
  // 单栏论文的正文行大多跨越中线；双栏论文则很少
  const twoColumn = right.length >= 3 && full.length < items.length * 0.35;
  if (!twoColumn) return groupLines(items);

  const fullLines = groupLines(full);
  const segments: { left: RawItem[]; right: RawItem[] }[] = fullLines.map(() => ({ left: [], right: [] }));
  segments.push({ left: [], right: [] });
  for (const it of items) {
    if (isFull(it)) continue;
    // 区段编号 = 位于该文本项上方的通栏行数量
    const seg = fullLines.filter((l) => l.y > it.y + 1).length;
    (it.x >= mid - 10 ? segments[seg].right : segments[seg].left).push(it);
  }

  const out: Line[] = [];
  segments.forEach((s, i) => {
    out.push(...groupLines(s.left), ...groupLines(s.right));
    if (fullLines[i]) out.push(fullLines[i]);
  });
  return out;
}

function groupLines(items: RawItem[]): Line[] {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: { items: RawItem[]; y: number; size: number }[] = [];
  for (const it of sorted) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.y - it.y) < Math.max(2, last.size * 0.5)) {
      last.items.push(it);
      last.size = Math.max(last.size, it.size);
    } else {
      lines.push({ items: [it], y: it.y, size: it.size });
    }
  }
  return lines.map((l) => {
    const parts = l.items.sort((a, b) => a.x - b.x);
    let text = "";
    let end = -Infinity;
    for (const p of parts) {
      // 文本项之间有明显间隔时补空格
      if (text && p.x - end > p.size * 0.15 && !text.endsWith(" ") && !p.str.startsWith(" ")) text += " ";
      text += p.str;
      end = p.x + p.width;
    }
    return { text: text.replace(/\s+/g, " ").trim(), x: parts[0].x, y: l.y, size: l.size };
  });
}

function modeFontSize(lines: Line[]) {
  const counts = new Map<number, number>();
  for (const l of lines) {
    const k = Math.round(l.size * 2) / 2;
    counts.set(k, (counts.get(k) ?? 0) + l.text.length);
  }
  let best = 10;
  let max = 0;
  for (const [k, v] of counts) if (v > max) [best, max] = [k, v];
  return best;
}

function guessTitle(lines: Line[], bodySize: number) {
  const top = lines.slice(0, 15);
  const maxSize = Math.max(...top.map((l) => l.size), 0);
  if (maxSize < bodySize * 1.2) return top[0]?.text.slice(0, 200) ?? "未命名论文";
  return top
    .filter((l) => l.size >= maxSize - 0.5)
    .map((l) => l.text)
    .join(" ")
    .slice(0, 200);
}

function isHeading(line: Line, bodySize: number) {
  const t = line.text;
  if (t.length > 100 || t.length < 3) return false;
  if (KNOWN_SECTIONS.test(t) && t.split(" ").length <= 6) return true;
  if (NUMBERED_HEADING.test(t) && line.size >= bodySize * 0.98 && !/[,;]$/.test(t)) return true;
  return line.size > bodySize * 1.15 && !/[.,;:]$/.test(t);
}

/** 行 → 段落：依据行距、缩进、句末标点切分，并合并连字符断词 */
function buildChunks(pages: { lines: Line[] }[], bodySize: number, title: string): ParsedPdf["chunks"] {
  const chunks: ParsedPdf["chunks"] = [];
  let section = "";
  let inReferences = false;
  let buf: string[] = [];
  let bufPage = 1;

  const push = (kind: ChunkKind, text: string, page: number) => {
    const clean = text.replace(/\s+/g, " ").trim();
    if (clean.length < 2) return;
    for (const piece of kind === "paragraph" || kind === "reference" ? splitLong(clean) : [clean]) {
      const order = chunks.length;
      chunks.push({ ref: `c${order}`, order, page, section, kind, text: piece });
    }
  };
  const flush = () => {
    if (buf.length) push(inReferences ? "reference" : "paragraph", joinLines(buf), bufPage);
    buf = [];
  };

  if (title) chunks.push({ ref: "c0", order: 0, page: 1, section: "", kind: "title", text: title });

  pages.forEach((page, idx) => {
    const pageNo = idx + 1;
    let prev: Line | null = null;
    for (const line of page.lines) {
      // 跳过页码、页眉中的纯数字行，以及已作为标题输出的行
      if (/^\d{1,3}$/.test(line.text)) continue;
      if (pageNo === 1 && title.includes(line.text) && line.size > bodySize * 1.2) continue;

      if (isHeading(line, bodySize)) {
        flush();
        section = line.text;
        if (REFERENCES.test(line.text)) inReferences = true;
        push("heading", line.text, pageNo);
        prev = line;
        continue;
      }

      if (prev && buf.length) {
        const gap = prev.y - line.y;
        const bigGap = gap > Math.max(prev.size, line.size) * 1.9 || gap < -5;
        const endsSentence = /[.!?:。]$/.test(buf[buf.length - 1]);
        const indented = line.x - prev.x > bodySize * 0.8;
        const refStart = inReferences && /^\[\d+\]/.test(line.text);
        if (bigGap || (endsSentence && indented) || refStart) flush();
      }
      if (!buf.length) bufPage = pageNo;
      buf.push(line.text);
      prev = line;
    }
  });
  flush();
  return chunks;
}

function joinLines(lines: string[]) {
  return lines.reduce((acc, l) => {
    if (!acc) return l;
    // 行尾连字符断词：“repre-” + “sentation” → “representation”
    if (/[a-z]-$/.test(acc) && /^[a-z]/.test(l)) return acc.slice(0, -1) + l;
    return `${acc} ${l}`;
  }, "");
}

/** 过长段落按句子切分，保证检索粒度与翻译请求大小合适 */
function splitLong(text: string): string[] {
  if (text.length <= MAX_CHUNK) return [text];
  const sentences = text.match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g) ?? [text];
  const out: string[] = [];
  let cur = "";
  for (const s of sentences) {
    if (cur && cur.length + s.length > MAX_CHUNK) {
      out.push(cur.trim());
      cur = "";
    }
    cur += s;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
