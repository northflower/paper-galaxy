import MiniSearch from "minisearch";
import type { Chunk, GlossaryTerm } from "../types";
import { cosine, embed } from "./embedder";

export interface SearchHit {
  chunk: Chunk;
  score: number;
  /** 命中该片段的检索通道 */
  sources: ("keyword" | "vector")[];
}

export interface SearchResult {
  hits: SearchHit[];
  /** 依据强度：两路检索都命中首条结果为 high */
  strength: "high" | "medium" | "low";
  usedVector: boolean;
  keywords: string[];
}

const RRF_K = 60;

/** 为一篇论文构建 BM25 索引（参考文献不参与检索） */
export function buildIndex(chunks: Chunk[]) {
  const index = new MiniSearch<Chunk>({
    idField: "id",
    fields: ["text", "section"],
    storeFields: [],
    searchOptions: { boost: { section: 0.5 }, prefix: true, fuzzy: 0.15 },
  });
  index.addAll(chunks.filter(isSearchable));
  return index;
}

function isSearchable(c: Chunk) {
  return c.kind === "paragraph" || c.kind === "heading";
}

/**
 * 混合检索：BM25 关键词（含改写后的英文检索词、术语表映射）+ 端侧向量，
 * 用 RRF（倒数排名融合）合并两路结果。
 */
export async function hybridSearch(params: {
  question: string;
  chunks: Chunk[];
  index: MiniSearch<Chunk>;
  glossary: GlossaryTerm[];
  rewritten?: string[];
  topK?: number;
}): Promise<SearchResult> {
  const { question, chunks, index, glossary, rewritten = [], topK = 6 } = params;
  const byId = new Map(chunks.map((c) => [c.id, c]));

  // 术语表反向映射：问题中出现中文译名时，补充英文原词
  const mapped = glossary.filter((t) => question.includes(t.translation)).map((t) => t.term);
  const keywords = [...new Set([...rewritten, ...mapped])];
  const keywordQuery = [question, ...keywords].join(" ");
  const keywordRank = index.search(keywordQuery, { combineWith: "OR" }).slice(0, 20).map((r) => String(r.id));

  let vectorRank: string[] = [];
  const withVec = chunks.filter((c) => c.embedding && isSearchable(c));
  if (withVec.length) {
    try {
      const [q] = await embed([question], "query");
      vectorRank = withVec
        .map((c) => ({ id: c.id, s: cosine(q, c.embedding!) }))
        .sort((a, b) => b.s - a.s)
        .slice(0, 20)
        .map((x) => x.id);
    } catch {
      // 向量通道失败时降级为纯关键词检索
    }
  }

  const fused = new Map<string, SearchHit>();
  const add = (ids: string[], source: "keyword" | "vector") =>
    ids.forEach((id, rank) => {
      const chunk = byId.get(id);
      if (!chunk) return;
      const hit = fused.get(id) ?? { chunk, score: 0, sources: [] };
      hit.score += 1 / (RRF_K + rank + 1);
      hit.sources.push(source);
      fused.set(id, hit);
    });
  add(keywordRank, "keyword");
  add(vectorRank, "vector");

  const hits = [...fused.values()].sort((a, b) => b.score - a.score).slice(0, topK);
  const strength = !hits.length ? "low" : hits[0].sources.length === 2 ? "high" : "medium";

  return { hits, strength, usedVector: vectorRank.length > 0, keywords };
}
