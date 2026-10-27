"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useMemo, useState } from "react";
import { db } from "../db";
import type { Chunk, Paper } from "../types";

/** 星系中的一颗星 = 一个已向量化的正文段落（小节标题文本过短，会自成一团，不放入星系） */
export interface Star {
  index: number;
  paperIndex: number;
  chunk: Omit<Chunk, "embedding" | "translation">;
}

export interface GalaxyPaper {
  paper: Pick<Paper, "id" | "title" | "oneLiner" | "embedStatus">;
  color: string;
  starCount: number;
}

/** 与界面主色协调的星云配色，按论文顺序循环使用 */
export const NEBULA_COLORS = ["#8b9dff", "#d98bff", "#5fd4ff", "#ffb86b", "#6ee7b7", "#ff8fb1", "#c4f06b", "#ffd86b"];

export type LayoutStatus = "loading" | "empty" | "forming" | "ready" | "error";

// 同一批星星的布局在本次会话内复用，返回星系页时不必重算
const layoutCache = new Map<string, Float32Array>();
let worker: Worker | null = null;
let seq = 0;

/** 读取全部论文的段落向量，在 Worker 中用 UMAP 降到三维，逐帧返回成形过程 */
export function useGalaxy() {
  const data = useLiveQuery(async () => {
    const papers = await db.papers.orderBy("createdAt").toArray();
    const chunks = await db.chunks.filter((c) => c.kind === "paragraph" && !!c.embedding && isProse(c.text)).toArray();
    return { papers, chunks };
  }, []);

  // 只有星星集合变化才重新布局，翻译写回等更新不触发
  const signature = data ? data.chunks.map((c) => c.id).sort().join("|") : "";
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const built = useMemo(() => (data ? buildStars(data.papers, data.chunks) : null), [signature, data?.papers.length]);

  const [positions, setPositions] = useState<Float32Array | null>(null);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<LayoutStatus>("loading");

  useEffect(() => {
    if (!built) return;
    if (built.stars.length < 4) {
      setStatus(built.stars.length ? "ready" : "empty");
      setPositions(built.stars.length ? scatter(built.stars.length) : null);
      return;
    }
    const cached = layoutCache.get(signature);
    if (cached) {
      setPositions(cached);
      setProgress(1);
      setStatus("ready");
      return;
    }
    // 先给随机初始位置，星星从一团混沌开始聚拢
    setPositions(scatter(built.stars.length));
    setProgress(0);
    setStatus("forming");
    worker ??= new Worker(new URL("./umap.worker.ts", import.meta.url), { type: "module" });
    const id = ++seq;
    let last: Float32Array | null = null;
    const onMessage = (e: MessageEvent) => {
      const msg = e.data;
      if (msg.id !== id) return;
      if (msg.type === "frame") {
        setPositions(msg.positions);
        setProgress(msg.progress);
        last = msg.positions;
      } else if (msg.type === "done") {
        if (last) layoutCache.set(signature, last);
        setStatus("ready");
      } else {
        setStatus("error");
      }
    };
    worker.addEventListener("message", onMessage);
    worker.postMessage({ id, vectors: built.vectors });
    return () => worker?.removeEventListener("message", onMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [built]);

  return {
    papers: built?.papers ?? [],
    stars: built?.stars ?? [],
    vectors: built?.vectors ?? [],
    positions,
    progress,
    status: built ? status : "loading",
  };
}

function buildStars(papers: Paper[], chunks: Chunk[]) {
  const order = new Map(papers.map((p, i) => [p.id, i]));
  const sorted = chunks
    .filter((c) => order.has(c.paperId))
    .sort((a, b) => order.get(a.paperId)! - order.get(b.paperId)! || a.order - b.order);
  const counts = new Map<string, number>();
  const stars: Star[] = [];
  const vectors: number[][] = [];
  for (const c of sorted) {
    // 星星只保留展示所需字段，向量单独存放
    const chunk = { ...c };
    delete chunk.embedding;
    delete chunk.translation;
    stars.push({ index: stars.length, paperIndex: order.get(c.paperId)!, chunk });
    vectors.push(c.embedding!);
    counts.set(c.paperId, (counts.get(c.paperId) ?? 0) + 1);
  }
  const galaxyPapers: GalaxyPaper[] = papers.map((p, i) => ({
    paper: { id: p.id, title: p.title, oneLiner: p.oneLiner, embedStatus: p.embedStatus },
    color: NEBULA_COLORS[i % NEBULA_COLORS.length],
    starCount: counts.get(p.id) ?? 0,
  }));
  return { papers: galaxyPapers, stars, vectors };
}

/** 表格被解析成段落时多为数字与缩写，语义向量没有意义，不放入星系 */
function isProse(text: string) {
  const letters = text.match(/[a-z]/gi)?.length ?? 0;
  return letters / text.length > 0.6;
}

function scatter(n: number) {
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    // 均匀分布在球体内
    const r = 14 * Math.cbrt(Math.random());
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    out[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    out[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    out[i * 3 + 2] = r * Math.cos(phi);
  }
  return out;
}

/** 星云标签用的短标题：在单词边界截断 */
export function shortTitle(title: string, max = 44) {
  if (title.length <= max) return title;
  const cut = title.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), max * 0.6))}…`;
}
