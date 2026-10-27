"use client";

import clsx from "clsx";
import { ArrowRight, RotateCw } from "lucide-react";
import { useState } from "react";
import { TRAJECTORY_META, type Chunk, type JobStatus, type TrajectoryNode } from "@/lib/types";
import { useReader } from "@/stores/reader";

interface Props {
  nodes: TrajectoryNode[] | undefined;
  oneLiner?: string;
  status: JobStatus;
  error?: string;
  headings: Chunk[];
  labelOf: (ref: string) => string;
  onRetry: () => void;
  /** 跳转到正文后的回调（小屏用于关闭抽屉） */
  onNavigate?: () => void;
}

/**
 * 论文脉络：AI 把论文拆成“问题 → 方法 → 实验 → 结论”的论证链，每一环绑定原文依据；
 * 另附按章节标题生成的目录。
 */
export function PaperOutline({ nodes, oneLiner, status, error, headings, labelOf, onRetry, onNavigate }: Props) {
  const [tab, setTab] = useState<"flow" | "toc">("flow");
  const { activeNodeIndex, focus: rawFocus, ask } = useReader();
  const focus: typeof rawFocus = (refs, opts) => {
    rawFocus(refs, opts);
    if (opts?.scroll !== false) onNavigate?.();
  };

  return (
    <div className="flex h-full flex-col">
      <div className="mb-4 flex gap-1 rounded-lg bg-white/[0.03] p-0.5 text-xs">
        {(
          [
            ["flow", "脉络"],
            ["toc", "目录"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={clsx(
              "flex-1 rounded-md py-1.5 transition",
              tab === key ? "bg-white/[0.08] text-fg shadow-sm" : "text-faint hover:text-muted",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="scrollbar-thin -mr-2 min-h-0 flex-1 overflow-y-auto pr-2">
        {tab === "toc" ? (
          <ul className="space-y-0.5">
            {headings.map((h) => {
              const depth = /^(\d+|[A-H])(\.\d+)+\s/.test(h.text) ? h.text.split(" ")[0].split(".").length - 1 : 0;
              return (
                <li key={h.id}>
                  <button
                    onClick={() => focus([h.ref])}
                    className="w-full truncate rounded-md px-2 py-1 text-left text-[13px] text-muted transition hover:bg-white/[0.04] hover:text-fg"
                    style={{ paddingLeft: 8 + depth * 12 }}
                  >
                    {h.text}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : !nodes?.length ? (
          status === "error" ? (
            <div className="space-y-3 text-[13px]">
              <p className="text-red-300">脉络生成失败：{error}</p>
              <button onClick={onRetry} className="btn-ghost inline-flex items-center gap-1.5 px-2.5 py-1 text-xs">
                <RotateCw className="h-3 w-3" /> 重试
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-[13px] text-faint">AI 正在通读全文…</p>
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="space-y-1.5">
                  <div className="skeleton h-2.5 w-14" />
                  <div className="skeleton h-3.5 w-4/5" />
                </div>
              ))}
            </div>
          )
        ) : (
          <>
            {oneLiner && <p className="mb-5 text-[13px] leading-relaxed text-fg/80">{oneLiner}</p>}
            <ol className="relative">
              <span aria-hidden className="absolute bottom-3 left-[4px] top-3 w-px bg-line" />
              {nodes.map((node, i) => {
                const meta = TRAJECTORY_META[node.type];
                const active = i === activeNodeIndex;
                return (
                  <li key={i} className="relative pb-1 pl-5">
                    <span
                      aria-hidden
                      className="absolute left-0 top-[9px] h-[9px] w-[9px] rounded-full border-2 transition"
                      style={{
                        borderColor: meta.color,
                        background: active ? meta.color : "var(--surface)",
                        boxShadow: active ? `0 0 12px ${meta.color}` : undefined,
                      }}
                    />
                    <button
                      onClick={() => (active ? rawFocus([], { scroll: false }) : rawFocus(node.evidence, { nodeIndex: i }))}
                      className={clsx("w-full rounded-md py-1.5 text-left transition", !active && "hover:opacity-100", active ? "opacity-100" : "opacity-80")}
                    >
                      <span className="block text-[11px] tracking-wide" style={{ color: meta.color }}>
                        {meta.label}
                      </span>
                      <span className={clsx("block text-[13.5px] leading-snug", active ? "text-fg" : "text-fg/80")}>{node.title}</span>
                    </button>
                    {active && (
                      <div className="rise mb-3 mt-1 space-y-3">
                        <p className="text-[13px] leading-relaxed text-muted">{node.summary}</p>
                        <div className="flex flex-wrap gap-1.5">
                          {node.evidence.map((ref) => (
                            <button
                              key={ref}
                              onClick={() => focus([ref], { nodeIndex: i })}
                              className="btn-ghost px-1.5 py-0.5 text-[11px]"
                            >
                              {labelOf(ref)}
                            </button>
                          ))}
                        </div>
                        <button
                          onClick={() => ask(`请深入讲解「${node.title}」这一环节：作者具体怎么做的，为什么这样做？`)}
                          className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
                        >
                          深入追问 <ArrowRight className="h-3 w-3" />
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          </>
        )}
      </div>
    </div>
  );
}
