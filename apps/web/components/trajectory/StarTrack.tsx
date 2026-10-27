"use client";

import { MessageCircleQuestion, RotateCw } from "lucide-react";
import { TRAJECTORY_META, type JobStatus, type TrajectoryNode } from "@/lib/types";
import { useReader } from "@/stores/reader";

interface Props {
  nodes: TrajectoryNode[] | undefined;
  oneLiner?: string;
  status: JobStatus;
  error?: string;
  labelOf: (ref: string) => string;
  onRetry: () => void;
}

const W = 1000;
const H = 150;

/**
 * 研究轨迹星轨：论证链条上的每个环节是一颗星，按顺序连成星座。
 * 点击星星定位到支撑它的原文段落，下方展开导师式解读。
 */
export function StarTrack({ nodes, oneLiner, status, error, labelOf, onRetry }: Props) {
  const { activeNodeIndex, focus, ask } = useReader();

  if (!nodes?.length) {
    return (
      <div className="glass flex h-[150px] flex-col items-center justify-center gap-3 rounded-2xl text-sm text-muted">
        {status === "error" ? (
          <>
            <span className="text-red-300">研究轨迹生成失败：{error}</span>
            <button onClick={onRetry} className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1 hover:border-line-strong">
              <RotateCw className="h-3.5 w-3.5" /> 重试
            </button>
          </>
        ) : (
          <>
            <ConstellationLoader />
            <span>AI 正在通读全文，梳理研究轨迹…</span>
          </>
        )}
      </div>
    );
  }

  const n = nodes.length;
  const points = nodes.map((_, i) => ({
    x: 70 + (i * (W - 140)) / Math.max(1, n - 1),
    y: 62 + Math.sin(i * 1.3) * 26,
  }));
  const path = points.reduce((d, p, i) => {
    if (i === 0) return `M ${p.x} ${p.y}`;
    const prev = points[i - 1];
    const cx = (prev.x + p.x) / 2;
    return `${d} C ${cx} ${prev.y}, ${cx} ${p.y}, ${p.x} ${p.y}`;
  }, "");
  const active = activeNodeIndex !== null ? nodes[activeNodeIndex] : null;

  return (
    <div className="glass rounded-2xl">
      {oneLiner && (
        <div className="border-b border-line px-4 py-2.5 text-sm text-muted">
          <span className="mr-2 text-accent">一句话</span>
          {oneLiner}
        </div>
      )}
      <div className="scrollbar-thin overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} className="block h-[150px] min-w-[720px] w-full" role="list" aria-label="研究轨迹">
          <defs>
            <filter id="star-glow" x="-100%" y="-100%" width="300%" height="300%">
              <feGaussianBlur stdDeviation="6" />
            </filter>
            <linearGradient id="track" x1="0" x2="1">
              <stop offset="0%" stopColor="#7dd3fc" stopOpacity="0.6" />
              <stop offset="100%" stopColor="#f0abfc" stopOpacity="0.6" />
            </linearGradient>
          </defs>
          <path d={path} fill="none" stroke="url(#track)" strokeWidth="1.5" strokeDasharray="4 6">
            <animate attributeName="stroke-dashoffset" from="0" to="-60" dur="3s" repeatCount="indefinite" />
          </path>
          {nodes.map((node, i) => {
            const { x, y } = points[i];
            const meta = TRAJECTORY_META[node.type];
            const isActive = i === activeNodeIndex;
            return (
              <g
                key={i}
                role="listitem"
                tabIndex={0}
                aria-label={`${meta.label}：${node.title}`}
                className="cursor-pointer outline-none"
                onClick={() => focus(node.evidence, { nodeIndex: isActive ? null : i, scroll: !isActive })}
                onKeyDown={(e) => e.key === "Enter" && focus(node.evidence, { nodeIndex: i })}
                style={{ animation: `fadeIn 0.6s ease ${i * 0.08}s both` }}
              >
                <circle cx={x} cy={y} r={isActive ? 16 : 11} fill={meta.color} opacity={0.55} filter="url(#star-glow)" />
                <circle cx={x} cy={y} r={isActive ? 7 : 5} fill="#fff" stroke={meta.color} strokeWidth="2.5" />
                <text x={x} y={y + 34} textAnchor="middle" fontSize="11" fill={meta.color}>
                  {meta.label}
                </text>
                <text x={x} y={y + 50} textAnchor="middle" fontSize="13" fill={isActive ? "#fff" : "#c9cdf0"}>
                  {node.title.length > 10 ? `${node.title.slice(0, 10)}…` : node.title}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      {active && activeNodeIndex !== null && (
        <div className="border-t border-line px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className="rounded-full px-2 py-0.5 text-xs"
              style={{ background: `${TRAJECTORY_META[active.type].color}22`, color: TRAJECTORY_META[active.type].color }}
            >
              {TRAJECTORY_META[active.type].label}
            </span>
            <span className="font-medium">{active.title}</span>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-fg/85">{active.summary}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            <span className="text-faint">原文依据</span>
            {active.evidence.map((ref) => (
              <button
                key={ref}
                onClick={() => focus([ref], { nodeIndex: activeNodeIndex })}
                className="rounded-md border border-line px-2 py-0.5 text-muted hover:border-line-strong hover:text-fg"
              >
                {labelOf(ref)}
              </button>
            ))}
            <button
              onClick={() => ask(`请深入讲解「${active.title}」这一环节：作者具体怎么做的，为什么这样做？`)}
              className="ml-auto flex items-center gap-1 rounded-md bg-accent/15 px-2.5 py-1 text-accent hover:bg-accent/25"
            >
              <MessageCircleQuestion className="h-3.5 w-3.5" /> 深入追问
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ConstellationLoader() {
  const pts = [
    [10, 30],
    [40, 12],
    [70, 26],
    [100, 8],
    [130, 22],
  ];
  return (
    <svg viewBox="0 0 140 40" className="h-8 w-28">
      <polyline points={pts.map((p) => p.join(",")).join(" ")} fill="none" stroke="var(--accent)" strokeOpacity="0.35" />
      {pts.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="2.5" fill="#fff">
          <animate attributeName="opacity" values="0.2;1;0.2" dur="1.6s" begin={`${i * 0.2}s`} repeatCount="indefinite" />
        </circle>
      ))}
    </svg>
  );
}
