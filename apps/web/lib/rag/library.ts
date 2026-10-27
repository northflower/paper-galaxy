import { db } from "../db";
import { postJson } from "../stream";
import type { Chunk, QueryPlan } from "../types";
import { cosine, embed } from "./embedder";

export interface LibraryHit {
  chunk: Chunk;
  score: number;
}

export interface LibraryResult {
  /** AI 改写后的英文检索句；改写失败时为空，退化为直接用原问题检索 */
  rewritten: string | null;
  hits: LibraryHit[];
  searched: number;
  /** 尚未建立向量索引的论文数（打开论文后自动补全） */
  unindexed: number;
}

/** 表格被解析成段落时多为数字与缩写，语义向量没有意义 */
function isProse(text: string) {
  const letters = text.match(/[a-z]/gi)?.length ?? 0;
  return letters / text.length > 0.6;
}

/**
 * 全库语义检索：查询改写 → 端侧向量编码 → 与所有论文的段落向量计算余弦相似度。
 * 原问题与改写句一起编码，每段取两者中较高的相似度，兼顾中英文提问。
 */
export async function searchLibrary(question: string, topK = 12): Promise<LibraryResult> {
  const [rewritten, chunks, papers] = await Promise.all([
    postJson<QueryPlan>("/api/query-plan", { question, title: "论文库" })
      .then((p) => p.rewritten)
      .catch(() => null),
    db.chunks.filter((c) => c.kind === "paragraph" && !!c.embedding && isProse(c.text)).toArray(),
    db.papers.toArray(),
  ]);
  const queries = await embed(rewritten ? [question, rewritten] : [question], "query");
  const hits = chunks
    .map((chunk) => ({ chunk, score: Math.max(...queries.map((q) => cosine(q, chunk.embedding!))) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
  const indexed = new Set(chunks.map((c) => c.paperId));
  return { rewritten, hits, searched: chunks.length, unindexed: papers.filter((p) => !indexed.has(p.id)).length };
}
