"use client";

import { ArrowUpRight, Loader2, Search, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { checkUserInput } from "@/lib/ai/safety";
import { chunkLabel } from "@/lib/db";
import { searchLibrary, type LibraryResult } from "@/lib/rag/library";
import type { Paper } from "@/lib/types";

export function useLibrarySearch() {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<LibraryResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    const q = query.trim();
    const problem = checkUserInput(q, 200);
    if (problem) return setError(problem);
    setError(null);
    setBusy(true);
    try {
      setResult(await searchLibrary(q));
    } catch (err) {
      setError(`检索失败：${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const clear = () => {
    setQuery("");
    setResult(null);
    setError(null);
  };

  return { query, setQuery, result, busy, error, run, clear };
}

type SearchState = ReturnType<typeof useLibrarySearch>;

export function SearchBox({ search }: { search: SearchState }) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void search.run();
      }}
      className="flex h-9 w-full items-center gap-2 rounded-lg border border-line bg-white/[0.02] px-3 transition focus-within:border-line-strong focus-within:bg-white/[0.04] sm:w-80"
    >
      {search.busy ? <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" /> : <Search className="h-3.5 w-3.5 text-faint" />}
      <input
        value={search.query}
        onChange={(e) => search.setQuery(e.target.value)}
        placeholder="在所有论文中搜索…"
        className="flex-1 bg-transparent text-sm outline-none placeholder:text-faint"
      />
      {(search.query || search.result) && (
        <button type="button" aria-label="清除" onClick={search.clear} className="text-faint hover:text-fg">
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </form>
  );
}

export function SearchResults({ search, papers }: { search: SearchState; papers: Paper[] }) {
  const { result, error } = search;
  if (error) return <p className="py-10 text-center text-sm text-red-300">{error}</p>;
  if (!result) return null;
  const titleOf = new Map(papers.map((p) => [p.id, p.title]));

  return (
    <div className="rise">
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs text-faint">
        <span>
          {result.hits.length ? `${result.hits.length} 段相关内容` : "没有找到相关内容"}
          {result.unindexed > 0 && ` · ${result.unindexed} 篇论文尚未建立索引`}
        </span>
        {result.rewritten && <span className="italic">“{result.rewritten}”</span>}
      </div>
      <ul className="panel divide-y divide-line overflow-hidden rounded-xl">
        {result.hits.map(({ chunk, score }) => (
          <li key={chunk.id}>
            <Link
              href={`/paper/${chunk.paperId}?focus=${chunk.ref}`}
              className="group flex gap-4 px-5 py-4 transition hover:bg-white/[0.025]"
            >
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex items-center gap-2 text-xs text-faint">
                  <span className="truncate text-muted">{titleOf.get(chunk.paperId)}</span>
                  <span className="shrink-0">· {chunkLabel(chunk)}</span>
                </div>
                <p className="line-clamp-2 font-serif text-[15px] leading-relaxed text-fg/85">{chunk.text}</p>
              </div>
              <div className="flex shrink-0 flex-col items-end justify-between">
                <span className="font-mono text-xs tabular-nums text-faint">{(score * 100).toFixed(0)}</span>
                <ArrowUpRight className="h-4 w-4 text-faint opacity-0 transition group-hover:opacity-100" />
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
