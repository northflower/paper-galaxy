import type { Chunk, ChunkBox, ChunkKind } from "../types";

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
  width: number;
  size: number;
}

interface PageLines {
  lines: Line[];
  width: number;
  height: number;
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
// 编号标题：“4.2 SQuAD v1.1”“A.1 Pre-training”“A Additional Details”。标题内允许 “v1.1” 这类点号，但不允许句号断句
const NUMBERED_HEADING = /^((\d+(\.\d+){0,3})\.?|[IVX]{1,5}\.|[A-H](\.\d+){0,3}\.?)\s+[A-Z][\w-](?:(?![.!?:]\s)[^!?]){0,90}$/;
const CONTENTS = /^(table of )?contents$/i;
const REFERENCES = /^(\d+\.?\s*)?(references|bibliography)$/i;
// 公式中常见的数学符号
const MATH_CHARS = /[=∈∉∑∏∫−×÷≤≥≈≠∝‖∥√∂∇→←↦⊙⊗∀∃^_{}|]/;
/** 解析规则有变动时递增，旧论文打开时自动重新解析 */
export const PARSER_VERSION = 4;

export async function loadPdfjs() {
  const pdfjs = await import("pdfjs-dist");
  // worker 由 postinstall 脚本复制到 public 目录
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  return pdfjs;
}

/** 浏览器端解析 PDF：按坐标重建行与段落，自动处理双栏排版 */
export async function parsePdf(file: Blob, onProgress?: (page: number, total: number) => void): Promise<ParsedPdf> {
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;

  const pages: PageLines[] = [];
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
    // 去掉页眉、页脚（会议信息、版权声明、页码），它们不是正文
    const body = items.filter((it) => it.y > viewport.height * 0.075 && it.y < viewport.height * 0.955);
    pages.push({ lines: orderLines(body, viewport.width), width: viewport.width, height: viewport.height });
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
  if (!isTwoColumn(items, mid)) return groupLines(items);
  const full = items.filter(isFull);

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

/**
 * 判断是否双栏：把整页文本项按行聚合后，双栏页的大多数行在中线附近有一道明显的栏间空白，
 * 单栏页的行则连续跨过中线。不能只数“跨中线的文本项”：有的 PDF 逐词输出文本项，单栏页也很少有项跨中线。
 */
function isTwoColumn(items: RawItem[], mid: number) {
  let split = 0;
  let solid = 0;
  for (const line of groupRaw(items)) {
    const parts = line.items.sort((a, b) => a.x - b.x);
    const left = parts.filter((p) => p.x + p.width <= mid + 4);
    const right = parts.filter((p) => p.x >= mid - 4);
    if (parts.some((p) => p.x < mid - 4 && p.x + p.width > mid + 4)) solid++;
    else if (!left.length || !right.length) {
      // 只落在一侧的行：右侧独有的行是双栏的证据，左侧独有的行（短行、段尾）不计
      if (!left.length) split++;
    } else {
      const gap = right[0].x - (left[left.length - 1].x + left[left.length - 1].width);
      if (gap > 8) split++;
      else solid++;
    }
  }
  return split >= 3 && split > solid;
}

/** 按基线把文本项聚成行。上下标字号小、基线有偏移，按行内最大字号判断，避免被拆成独立的行 */
function groupRaw(items: RawItem[]) {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: { items: RawItem[]; y: number; size: number }[] = [];
  for (const it of sorted) {
    const last = lines[lines.length - 1];
    const size = Math.max(last?.size ?? 0, it.size);
    if (last && Math.abs(last.y - it.y) < Math.max(2, size * 0.55)) {
      last.items.push(it);
      // 行的基线取正文字号文本项的基线
      if (it.size > last.size) last.y = it.y;
      last.size = size;
    } else {
      lines.push({ items: [it], y: it.y, size: it.size });
    }
  }
  return lines;
}

function groupLines(items: RawItem[]): Line[] {
  const lines = groupRaw(items);
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
    return { text: text.replace(/\s+/g, " ").trim(), x: parts[0].x, y: l.y, width: end - parts[0].x, size: l.size };
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
  if (NUMBERED_HEADING.test(t) && line.size >= bodySize * 0.98 && !/[.,;:]$/.test(t)) return true;
  return line.size > bodySize * 1.15 && !/[.,;:]$/.test(t);
}

/** 行 → 段落：依据行距、缩进、句末标点切分，并合并连字符断词 */
function buildChunks(pages: PageLines[], bodySize: number, title: string): ParsedPdf["chunks"] {
  const chunks: ParsedPdf["chunks"] = [];
  let section = "";
  let inReferences = false;
  // 缓存当前段落的行及其页码，用于拼接文本和计算段落在页面上的位置
  let buf: { line: Line; page: number }[] = [];

  const push = (kind: ChunkKind, text: string, page: number, boxes: ChunkBox[]) => {
    const clean = text.replace(/\s+/g, " ").trim();
    if (clean.length < 2) return;
    // 过长段落拆分后，各片段共用整段的位置
    for (const piece of kind === "paragraph" || kind === "reference" ? splitLong(clean) : [clean]) {
      const order = chunks.length;
      chunks.push({ ref: `c${order}`, order, page, section, kind, text: piece, boxes });
    }
  };
  const flush = () => {
    if (!buf.length) return;
    const text = joinLines(buf.map((b) => b.line.text));
    if (inReferences || !isFigureNoise(text)) {
      push(inReferences ? "reference" : "paragraph", text, buf[0].page, lineBoxes(buf, pages));
    }
    buf = [];
  };

  if (title) chunks.push({ ref: "c0", order: 0, page: 1, section: "", kind: "title", text: title });

  let tocPage = 0;
  pages.forEach((page, idx) => {
    const pageNo = idx + 1;
    let prev: Line | null = null;
    // 当前段落内的行距
    let pitch = 0;
    // 段落可以跨页延续；上一页最后一行已经句末收尾时，新页另起一段
    if (buf.length && /[.!?。]$/.test(buf[buf.length - 1].line.text)) flush();
    for (const line of page.lines) {
      // 目录页的条目长得和标题一样，整页跳过
      if (pageNo === tocPage) continue;
      if (CONTENTS.test(line.text)) {
        flush();
        tocPage = pageNo;
        continue;
      }
      // 跳过页码、页眉中的纯数字行，以及已作为标题输出的行
      if (/^\d{1,3}$/.test(line.text)) continue;
      if (pageNo === 1 && title.includes(line.text) && line.size > bodySize * 1.2) continue;

      // 独立公式行：结束当前段落且不进入正文，译文页保留公式原样
      if (!inReferences && isMathLine(line.text)) {
        flush();
        prev = null;
        continue;
      }

      if (isHeading(line, bodySize)) {
        flush();
        section = line.text;
        // 参考文献之后再出现标题，说明进入了附录
        inReferences = REFERENCES.test(line.text);
        push("heading", line.text, pageNo, lineBoxes([{ line, page: pageNo }], pages));
        prev = line;
        continue;
      }

      if (prev && buf.length) {
        const gap = prev.y - line.y;
        const bigGap = gap > Math.max(prev.size, line.size) * 1.9 || gap < -5;
        const endsSentence = /[.!?:。]$/.test(buf[buf.length - 1].line.text);
        const indented = line.x - prev.x > bodySize * 0.8;
        // 不缩进的排版（如 NeurIPS）靠段间距区分段落：比段内行距明显更大
        const spaced = pitch > 0 && gap > pitch * 1.3;
        const refStart = inReferences && /^\[\d+\]/.test(line.text);
        if (bigGap || (endsSentence && (indented || spaced)) || refStart) flush();
        // 上下标等异常小的行距不计入
        else if (gap > line.size * 0.9) pitch = pitch ? Math.min(pitch, gap) : gap;
      }
      if (!buf.length) pitch = 0;
      buf.push({ line, page: pageNo });
      prev = line;
    }
  });
  flush();
  return chunks;
}

/**
 * 段落在页面上的矩形区域（左上角为原点，单位为 PDF 点）。
 * 跨栏或跨页时拆成多个矩形：换页、或下一行跑到上方（进入右栏）时另起一块。
 */
function lineBoxes(lines: { line: Line; page: number }[], pages: PageLines[]): ChunkBox[] {
  const boxes: ChunkBox[] = [];
  let cur: { page: number; x0: number; x1: number; top: number; bottom: number } | null = null;
  const commit = () => {
    if (!cur) return;
    const pad = 2;
    boxes.push({ page: cur.page, x: cur.x0 - pad, y: cur.top - pad, w: cur.x1 - cur.x0 + pad * 2, h: cur.bottom - cur.top + pad * 2 });
  };
  for (const { line, page } of lines) {
    const h = pages[page - 1]?.height ?? 0;
    const top = h - (line.y + line.size * 0.9);
    const bottom = h - (line.y - line.size * 0.25);
    if (cur && cur.page === page && top >= cur.top - 2) {
      cur.x0 = Math.min(cur.x0, line.x);
      cur.x1 = Math.max(cur.x1, line.x + line.width);
      cur.bottom = Math.max(cur.bottom, bottom);
    } else {
      commit();
      cur = { page, x0: line.x, x1: line.x + line.width, top, bottom };
    }
  }
  commit();
  return boxes;
}

/** 独立公式行：普通英文单词很少，且含数学符号或以公式编号 “(3)” 结尾 */
function isMathLine(text: string) {
  if (text.length > 160) return false;
  const words = text.split(" ");
  const plain = words.filter((w) => /^[a-z]{3,}[.,;:]?$/i.test(w)).length;
  if (plain >= 6) return false;
  const numbered = /\(\d{1,3}[a-z]?\)$/.test(text);
  return (numbered || MATH_CHARS.test(text)) && plain / words.length < 0.4;
}

/** 图表内部的零散标签（“C T1 ... TN”“Fine-Tuning”），不是正文，不进入翻译与检索 */
function isFigureNoise(text: string) {
  // 与正文分离的图表编号，如 “Table 3.4:”
  if (/^(table|figure|fig\.)\s*([A-Z]\.?)?\d+(\.\d+)*[:.]?$/i.test(text)) return true;
  if (text.length > 400 || /[.!?:。]$/.test(text)) return false;
  const words = text.split(" ");
  // 正文以小写普通词为主；图中标签多为大写缩写、符号和省略号
  const plain = words.filter((w) => /^[a-z]{3,}[,;]?$/.test(w)).length;
  return words.length < 8 || plain / words.length < 0.3;
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
  // 只在“句末标点 + 空格 + 大写字母”处切开，不丢任何字符（“et al., 2023” 这类缩写不会被当成句末）
  const sentences = text.split(/(?<=[.!?])\s+(?=[A-Z(“"])/);
  const out: string[] = [];
  let cur = "";
  for (const s of sentences) {
    if (cur && cur.length + s.length > MAX_CHUNK) {
      out.push(cur.trim());
      cur = "";
    }
    cur += (cur ? " " : "") + s;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
