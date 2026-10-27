"use client";

import clsx from "clsx";
import { ArrowDownLeft, ArrowUpRight, Check, FileText, Loader2, Plug, Search, SendHorizontal, X } from "lucide-react";
import { useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type Goal = "background" | "followup" | "related" | "custom";

interface Step {
  id: string;
  name: string;
  input: Record<string, unknown>;
  summary?: string;
  error?: string;
}

interface Run {
  id: string;
  goal: string;
  tools: string[];
  steps: Step[];
  report: string;
  status: "running" | "done" | "error";
  error?: string;
}

const PRESETS: { goal: Goal; label: string }[] = [
  { goal: "background", label: "前置工作" },
  { goal: "followup", label: "后续工作" },
  { goal: "related", label: "相近研究" },
];

const TOOL_META: Record<string, { label: string; icon: typeof Search }> = {
  search_arxiv: { label: "检索 arXiv", icon: Search },
  get_paper: { label: "查询论文详情", icon: FileText },
  get_references: { label: "获取参考文献", icon: ArrowDownLeft },
  get_citations: { label: "获取被引文献", icon: ArrowUpRight },
};

/**
 * 学者 Agent 面板：选择调研目标后，Agent 通过 MCP 调用学术检索工具，
 * 时间线实时展示每一步的工具调用与结果，最后给出带链接的研究脉络报告。
 */
export function ScholarPanel({ title, summary }: { title: string; summary?: string }) {
  const [runs, setRuns] = useState<Run[]>([]);
  const [custom, setCustom] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const running = runs.some((r) => r.status === "running");

  const update = (id: string, fn: (r: Run) => Run) => setRuns((rs) => rs.map((r) => (r.id === id ? fn(r) : r)));

  const start = async (goal: Goal, label: string) => {
    if (running) return;
    const id = crypto.randomUUID();
    const controller = new AbortController();
    abortRef.current = controller;
    setRuns((rs) => [...rs, { id, goal: label, tools: [], steps: [], report: "", status: "running" }]);
    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, summary, goal, custom: goal === "custom" ? label : "" }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `请求失败（${res.status}）`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) if (line.trim()) handle(id, JSON.parse(line));
      }
      update(id, (r) => ({ ...r, status: r.status === "error" ? "error" : "done" }));
    } catch (err) {
      const aborted = controller.signal.aborted;
      update(id, (r) => ({ ...r, status: aborted ? "done" : "error", error: aborted ? "已停止" : (err as Error).message }));
    } finally {
      abortRef.current = null;
    }
  };

  // NDJSON 事件：tools / call / result / text / fatal / done
  const handle = (id: string, e: Record<string, unknown>) => {
    update(id, (r) => {
      switch (e.type) {
        case "tools":
          return { ...r, tools: e.names as string[] };
        case "call":
          return { ...r, steps: [...r.steps, { id: e.id as string, name: e.name as string, input: e.input as Record<string, unknown> }] };
        case "result":
          return {
            ...r,
            steps: r.steps.map((s) => (s.id === e.id ? { ...s, summary: e.summary as string, error: e.error as string } : s)),
          };
        case "text":
          return { ...r, report: r.report + (e.delta as string) };
        case "fatal":
          return { ...r, status: "error", error: e.message as string };
        default:
          return r;
      }
    });
  };

  return (
    <div className="flex h-full flex-col">
      <div className="scrollbar-thin flex-1 space-y-6 overflow-y-auto p-4">
        {runs.length === 0 && (
          <div className="flex h-full flex-col justify-end pb-2 text-[13px] text-muted">
            <p className="mb-1 flex items-center gap-2">
              <Plug className="h-3.5 w-3.5 text-accent" /> 学者 Agent
            </p>
            <p className="text-xs leading-relaxed text-faint">
              通过 MCP 连接 arXiv 与 Semantic Scholar，自主检索并梳理这篇论文的研究脉络。
            </p>
          </div>
        )}
        {runs.map((run) => (
          <section key={run.id} className="space-y-3">
            <div className="flex items-center gap-2 text-[13px] font-medium">
              <span className="rounded-md bg-accent/15 px-2 py-0.5 text-accent">{run.goal}</span>
              {run.tools.length > 0 && <span className="text-[11px] font-normal text-faint">已连接 scholar-mcp · {run.tools.length} 个工具</span>}
            </div>

            {/* Agent 时间线：每一次工具调用及其结果 */}
            {(run.steps.length > 0 || run.status === "running") && (
              <ol className="relative space-y-2.5 border-l border-line pl-4">
                {run.steps.map((s) => {
                  const meta = TOOL_META[s.name] ?? { label: s.name, icon: Search };
                  const Icon = meta.icon;
                  const pending = !s.summary && !s.error;
                  return (
                    <li key={s.id} className="relative text-xs">
                      <span
                        className={clsx(
                          "absolute -left-[21px] top-0.5 flex h-[10px] w-[10px] items-center justify-center rounded-full border",
                          s.error ? "border-red-400 bg-red-400/30" : pending ? "border-accent bg-bg" : "border-emerald-400 bg-emerald-400/30",
                        )}
                      />
                      <div className="flex items-center gap-1.5 text-fg/85">
                        <Icon className="h-3.5 w-3.5 text-accent" />
                        {meta.label}
                        {pending && <Loader2 className="h-3 w-3 animate-spin text-faint" />}
                      </div>
                      <div className="mt-0.5 truncate font-mono text-[11px] text-faint">{describeInput(s.input)}</div>
                      {(s.summary || s.error) && (
                        <div className={clsx("mt-0.5", s.error || s.summary?.startsWith("失败") ? "text-amber-300/90" : "text-muted")}>
                          {s.error ?? s.summary}
                        </div>
                      )}
                    </li>
                  );
                })}
                {run.status === "running" && (
                  <li className="relative flex items-center gap-1.5 text-xs text-faint">
                    <span className="absolute -left-[21px] top-0.5 h-[10px] w-[10px] animate-pulse rounded-full border border-accent" />
                    {!run.steps.length ? "规划检索策略…" : run.steps.some((s) => !s.summary && !s.error) ? "等待工具返回…" : "分析结果，规划下一步或撰写报告…"}
                  </li>
                )}
                {run.status === "done" && run.report && (
                  <li className="relative flex items-center gap-1.5 text-xs text-muted">
                    <span className="absolute -left-[21px] top-0.5 h-[10px] w-[10px] rounded-full border border-emerald-400 bg-emerald-400/30" />
                    <Check className="h-3.5 w-3.5 text-emerald-300" /> 完成调研，共调用 {run.steps.length} 次工具
                  </li>
                )}
              </ol>
            )}

            {run.report && (
              <div className={clsx("prose-answer text-[13.5px] leading-[1.75] text-fg/90", run.status === "running" && "caret")}>
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    a: ({ href, children }) => (
                      <a href={href} target="_blank" rel="noreferrer" className="text-accent underline-offset-2 hover:underline">
                        {children}
                      </a>
                    ),
                  }}
                >
                  {run.report}
                </ReactMarkdown>
              </div>
            )}
            {run.error && <p className="text-xs text-red-300">{run.error}</p>}
          </section>
        ))}
      </div>

      <div className="space-y-2 border-t border-line p-3">
        <div className="flex gap-1.5">
          {PRESETS.map((p) => (
            <button
              key={p.goal}
              disabled={running}
              onClick={() => start(p.goal, p.label)}
              className="btn-ghost flex-1 py-1.5 text-xs disabled:opacity-40"
            >
              {p.label}
            </button>
          ))}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const goal = custom.trim();
            if (!goal) return;
            setCustom("");
            void start("custom", goal);
          }}
          className="flex items-center gap-2 rounded-xl border border-line bg-white/[0.02] p-1.5 pl-3 transition focus-within:border-line-strong"
        >
          <input
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            placeholder="自定义调研目标，如：找用对比学习改进它的工作"
            className="flex-1 bg-transparent text-[13px] outline-none placeholder:text-faint"
          />
          {running ? (
            <button type="button" aria-label="停止" onClick={() => abortRef.current?.abort()} className="rounded-lg bg-white/10 p-1.5">
              <X className="h-4 w-4" />
            </button>
          ) : (
            <button type="submit" aria-label="开始调研" disabled={!custom.trim()} className="rounded-lg bg-fg p-1.5 text-bg disabled:opacity-20">
              <SendHorizontal className="h-4 w-4" />
            </button>
          )}
        </form>
      </div>
    </div>
  );
}

function describeInput(input: Record<string, unknown>) {
  const main = input.query ?? input.paper_id ?? input.id_or_doi;
  const extra = Object.entries(input)
    .filter(([k]) => !["query", "paper_id", "id_or_doi"].includes(k))
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
  return [main, extra].filter(Boolean).join("  ");
}
