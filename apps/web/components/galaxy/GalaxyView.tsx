"use client";

import clsx from "clsx";
import { ArrowLeft, BookOpen, Loader2, Search, Sparkles, X } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useState } from "react";
import { checkUserInput } from "@/lib/ai/safety";
import { chunkLabel } from "@/lib/db";
import { shortTitle, useGalaxy } from "@/lib/galaxy/useGalaxy";
import { cosine, embed } from "@/lib/rag/embedder";
import { postJson } from "@/lib/stream";
import type { QueryPlan } from "@/lib/types";
import type { Hit } from "./GalaxyScene";

// three.js 体积较大，只在星系页按需加载
const GalaxyScene = dynamic(() => import("./GalaxyScene"), {
  ssr: false,
  loading: () => <div className="flex h-full items-center justify-center text-sm text-muted">正在点亮星系…</div>,
});

const TOP_K = 12;
const SUGGESTIONS = ["预训练与微调的区别", "模型规模对效果的影响", "评测用了哪些数据集", "方法有什么局限"];

interface SearchTrace {
  query: string;
  /** AI 改写后的英文检索语句；改写失败时为空，退化为直接用原问题检索 */
  rewritten: string | null;
  rewriteMs: number;
  embedMs: number;
  searchMs: number;
  total: number;
}

/** 知识星系：所有论文的段落按语义降维成三维星图，检索时命中的星依次点亮 */
export function GalaxyView() {
  const { papers, stars, vectors, positions, progress, status } = useGalaxy();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [trace, setTrace] = useState<SearchTrace | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const [focusPaper, setFocusPaper] = useState<number | null>(null);

  const search = async (q: string) => {
    const problem = checkUserInput(q, 200);
    if (problem) return setError(problem);
    setError(null);
    setSearching(true);
    setSelected(null);
    setQuery(q);
    try {
      // ① 查询改写：论文多为英文，把问题改写成英文检索语句能明显提升跨语言召回
      const t0 = performance.now();
      const rewritten = await postJson<QueryPlan>("/api/query-plan", { question: q, title: "多篇论文" })
        .then((plan) => plan.rewritten)
        .catch(() => null);
      const t1 = performance.now();
      // ② 原问题与改写句一起编码，每颗星取两者中较高的相似度
      const queries = await embed(rewritten ? [q, rewritten] : [q], "query");
      const t2 = performance.now();
      const scored = vectors.map((v, index) => ({ index, score: Math.max(...queries.map((qv) => cosine(qv, v))) }));
      scored.sort((a, b) => b.score - a.score);
      const top = scored.slice(0, TOP_K);
      setTrace({
        query: q,
        rewritten,
        rewriteMs: t1 - t0,
        embedMs: t2 - t1,
        searchMs: performance.now() - t2,
        total: vectors.length,
      });
      setHits(top);
    } catch (err) {
      setError(`检索失败：${(err as Error).message}`);
    } finally {
      setSearching(false);
    }
  };

  const clear = () => {
    setHits([]);
    setTrace(null);
    setSelected(null);
    setQuery("");
  };

  const selectedStar = selected !== null ? stars[selected] : null;
  const pending = papers.filter((p) => p.starCount === 0);
  const ready = status === "forming" || status === "ready";

  return (
    <div className="fixed inset-0 overflow-hidden">
      <div className="absolute inset-0">
        {ready && positions && (
          <GalaxyScene
            stars={stars}
            papers={papers}
            positions={positions}
            hits={hits}
            selected={selected}
            hovered={hovered}
            focusPaper={focusPaper}
            onHover={setHovered}
            onSelect={(i) => {
              setSelected(i);
              setFocusPaper(null);
            }}
          />
        )}
      </div>

      {/* 顶栏 */}
      <header className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-3 p-4">
        <div className="pointer-events-auto flex items-center gap-3">
          <Link href="/" aria-label="返回首页" className="glass rounded-lg p-2 text-muted transition hover:text-fg">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <h1 className="text-lg font-semibold">
              <span className="text-gradient">知识星系</span>
            </h1>
            <p className="text-xs text-faint">
              {papers.length} 篇论文 · {stars.length} 颗星 · 每颗星是一个段落，语义相近的段落彼此靠近
            </p>
          </div>
        </div>
        {status === "forming" && (
          <div className="glass pointer-events-auto flex items-center gap-2 rounded-full px-3 py-1.5 text-xs text-muted">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />
            UMAP 降维，星系成形中 {Math.round(progress * 100)}%
          </div>
        )}
      </header>

      {status === "empty" && (
        <div className="absolute inset-0 flex items-center justify-center p-6">
          <div className="glass max-w-sm rounded-2xl p-6 text-center">
            <Sparkles className="mx-auto mb-3 h-6 w-6 text-accent" />
            <div className="font-medium">星系里还没有星星</div>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              上传论文并打开阅读，端侧向量化完成后，它的每个段落都会化作一颗星出现在这里。
            </p>
            <Link href="/" className="mt-4 inline-block text-sm text-accent hover:underline">
              去上传论文
            </Link>
          </div>
        </div>
      )}
      {status === "error" && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-red-300">星系布局计算失败，请刷新重试</div>
      )}

      {/* 图例：论文星云 */}
      {papers.length > 0 && (
        <aside className="glass absolute bottom-24 left-4 max-h-[40dvh] w-64 overflow-y-auto rounded-xl p-2 max-sm:hidden">
          {papers.map((p, i) => (
            <button
              key={p.paper.id}
              disabled={!p.starCount}
              onClick={() => {
                setSelected(null);
                setFocusPaper(i);
              }}
              className={clsx(
                "flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition enabled:hover:bg-white/5",
                focusPaper === i && "bg-white/5",
              )}
            >
              <span className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ background: p.color, boxShadow: `0 0 8px ${p.color}` }} />
              <span className="min-w-0 flex-1">
                <span className="line-clamp-1 text-fg/90">{shortTitle(p.paper.title)}</span>
                <span className="text-faint">{p.starCount ? `${p.starCount} 颗星` : "尚未向量化，打开论文后自动完成"}</span>
              </span>
            </button>
          ))}
          {pending.length > 0 && <div className="px-2 pt-1 text-[11px] text-faint">未向量化的论文暂不显示</div>}
        </aside>
      )}

      {/* 检索结果 / 选中段落 */}
      {(selectedStar || trace) && (
        <aside className="glass absolute right-4 top-20 flex max-h-[calc(100dvh-11rem)] w-80 flex-col rounded-xl max-sm:inset-x-3 max-sm:bottom-24 max-sm:top-auto max-sm:max-h-[45dvh] max-sm:w-auto">
          {selectedStar ? (
            <div className="overflow-y-auto p-4">
              <div className="mb-2 flex items-start justify-between gap-2">
                <div className="text-xs font-medium" style={{ color: papers[selectedStar.paperIndex]?.color }}>
                  {shortTitle(papers[selectedStar.paperIndex]?.paper.title ?? "")}
                </div>
                <button aria-label="关闭" onClick={() => setSelected(null)} className="text-faint hover:text-fg">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="mb-2 text-xs text-faint">{chunkLabel(selectedStar.chunk)}</div>
              <p className="font-serif text-sm leading-6 text-fg/90">{selectedStar.chunk.text}</p>
              <Link
                href={`/paper/${selectedStar.chunk.paperId}?focus=${selectedStar.chunk.ref}`}
                className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-accent/15 px-3 py-1.5 text-sm text-accent transition hover:bg-accent/25"
              >
                <BookOpen className="h-4 w-4" /> 在阅读器中打开
              </Link>
            </div>
          ) : (
            trace && (
              <>
                <div className="border-b border-line p-3 text-xs text-muted">
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="font-medium text-fg">检索路径</span>
                    <button onClick={clear} className="text-faint hover:text-fg">
                      清除
                    </button>
                  </div>
                  <ol className="space-y-0.5">
                    <li>
                      ① {trace.rewritten ? "AI 改写为英文检索句" : "查询改写不可用，直接检索"} · {(trace.rewriteMs / 1000).toFixed(1)} s
                      {trace.rewritten && <div className="mt-0.5 pl-4 italic text-faint">“{trace.rewritten}”</div>}
                    </li>
                    <li>② 端侧模型编码为向量 · {trace.embedMs.toFixed(0)} ms</li>
                    <li>
                      ③ 与 {trace.total} 颗星计算余弦相似度 · {trace.searchMs.toFixed(1)} ms
                    </li>
                    <li>④ 按相关度依次点亮前 {hits.length} 颗</li>
                  </ol>
                </div>
                <ul className="overflow-y-auto p-2">
                  {hits.map((h, rank) => {
                    const s = stars[h.index];
                    const paper = papers[s.paperIndex];
                    return (
                      <li key={h.index}>
                        <button
                          onClick={() => setSelected(h.index)}
                          onMouseEnter={() => setHovered(h.index)}
                          onMouseLeave={() => setHovered(null)}
                          className="w-full rounded-lg p-2 text-left text-xs transition hover:bg-white/5"
                        >
                          <div className="mb-0.5 flex items-center gap-1.5">
                            <span className="text-faint">{rank + 1}</span>
                            <span className="h-1.5 w-1.5 rounded-full" style={{ background: paper?.color }} />
                            <span className="line-clamp-1 flex-1 text-fg/80">{shortTitle(paper?.paper.title ?? "")}</span>
                            <span className="text-accent">{(h.score * 100).toFixed(0)}</span>
                          </div>
                          <div className="text-faint">{chunkLabel(s.chunk)}</div>
                          <div className="mt-0.5 line-clamp-2 text-muted">{s.chunk.text}</div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </>
            )
          )}
        </aside>
      )}

      {/* 检索框 */}
      {stars.length > 0 && (
        <div className="absolute inset-x-0 bottom-0 flex flex-col items-center gap-2 p-4">
          {!trace && !searching && (
            <div className="flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => search(s)}
                  className="glass rounded-full px-3 py-1 text-xs text-muted transition hover:text-fg"
                >
                  {s}
                </button>
              ))}
            </div>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (query.trim()) void search(query.trim());
            }}
            className="glass flex w-full max-w-xl items-center gap-2 rounded-full px-4 py-2.5"
          >
            {searching ? <Loader2 className="h-4 w-4 animate-spin text-accent" /> : <Search className="h-4 w-4 text-faint" />}
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="跨论文语义检索，例如：注意力机制的作用"
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-faint"
            />
            {error && <span className="text-xs text-red-300">{error}</span>}
          </form>
        </div>
      )}
    </div>
  );
}
