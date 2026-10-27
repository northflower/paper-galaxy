"use client";

import { RotateCw, Search } from "lucide-react";
import { useState } from "react";
import type { GlossaryTerm, JobStatus } from "@/lib/types";
import { useReader } from "@/stores/reader";

interface Props {
  terms: GlossaryTerm[] | undefined;
  status: JobStatus;
  error?: string;
  onRetry: () => void;
}

/** 论文术语表：翻译时自动注入，保证全文译名统一 */
export function GlossaryPanel({ terms, status, error, onRetry }: Props) {
  const [q, setQ] = useState("");
  const ask = useReader((s) => s.ask);

  if (!terms?.length) {
    return (
      <div className="p-6 text-center text-sm text-muted">
        {status === "error" ? (
          <div className="space-y-3">
            <div className="text-red-300">术语抽取失败：{error}</div>
            <button onClick={onRetry} className="inline-flex items-center gap-1.5 rounded-md border border-line px-3 py-1 hover:border-line-strong">
              <RotateCw className="h-3.5 w-3.5" /> 重试
            </button>
          </div>
        ) : status === "running" ? (
          "正在抽取论文术语…"
        ) : (
          "暂无术语"
        )}
      </div>
    );
  }

  const list = terms.filter((t) => !q || `${t.term}${t.translation}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-line p-3">
        <label className="flex items-center gap-2 rounded-lg border border-line bg-white/[0.02] px-2.5 py-1.5 transition focus-within:border-line-strong">
          <Search className="h-3.5 w-3.5 text-faint" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={`搜索 ${terms.length} 个术语`}
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-faint"
          />
        </label>
      </div>
      <ul className="scrollbar-thin flex-1 divide-y divide-line overflow-y-auto">
        {list.map((t) => (
          <li key={t.term} className="group px-4 py-3">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-serif text-[15px] text-accent">{t.term}</span>
              <span className="shrink-0 text-[13px] text-fg/90">{t.translation}</span>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-muted">{t.explanation}</p>
            <button
              onClick={() => ask(`结合这篇论文，解释一下“${t.term}”是什么，在文中起什么作用？`)}
              className="mt-1.5 text-xs text-faint opacity-0 transition hover:text-accent group-hover:opacity-100"
            >
              结合论文解释 →
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
