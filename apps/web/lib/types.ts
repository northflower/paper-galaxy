import { z } from "zod";

/** 研究轨迹节点类型：论文论证链条上的一个环节 */
export const TRAJECTORY_TYPES = [
  "problem",
  "motivation",
  "method",
  "innovation",
  "experiment",
  "result",
  "limitation",
] as const;
export type TrajectoryType = (typeof TRAJECTORY_TYPES)[number];

export const TRAJECTORY_META: Record<TrajectoryType, { label: string; color: string }> = {
  problem: { label: "研究问题", color: "#7dd3fc" },
  motivation: { label: "动机与空白", color: "#a5b4fc" },
  method: { label: "核心方法", color: "#c4b5fd" },
  innovation: { label: "关键创新", color: "#f0abfc" },
  experiment: { label: "实验设计", color: "#fcd34d" },
  result: { label: "主要结论", color: "#86efac" },
  limitation: { label: "局限与展望", color: "#fca5a5" },
};

export const trajectorySchema = z.object({
  oneLiner: z.string().describe("用一句中文概括整篇论文"),
  nodes: z
    .array(
      z.object({
        type: z.enum(TRAJECTORY_TYPES),
        title: z.string().describe("节点标题，中文，不超过 16 字"),
        summary: z.string().describe("中文解读，2-4 句"),
        evidence: z.array(z.string()).describe("支撑该节点的段落编号，如 c12"),
      }),
    )
    .min(3)
    .max(12),
});
export type Trajectory = z.infer<typeof trajectorySchema>;
export type TrajectoryNode = Trajectory["nodes"][number];

export const glossarySchema = z.object({
  terms: z
    .array(
      z.object({
        term: z.string().describe("原文术语"),
        translation: z.string().describe("中文译名"),
        explanation: z.string().describe("一句话中文解释"),
      }),
    )
    .max(40),
});
export type GlossaryTerm = z.infer<typeof glossarySchema>["terms"][number];

export const queryPlanSchema = z.object({
  keywords: z.array(z.string()).describe("用于检索英文原文的英文关键词"),
  rewritten: z.string().describe("改写后的英文检索语句"),
});
export type QueryPlan = z.infer<typeof queryPlanSchema>;

export type ChunkKind = "title" | "heading" | "paragraph" | "reference";

/** 段落在 PDF 页面上的位置：左上角为原点，单位为 PDF 点（scale = 1） */
export interface ChunkBox {
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Chunk {
  /** 主键：`${paperId}_${order}` */
  id: string;
  paperId: string;
  /** 论文内的短编号，用于引用溯源，如 c12 */
  ref: string;
  order: number;
  page: number;
  section: string;
  kind: ChunkKind;
  text: string;
  translation?: string;
  embedding?: number[];
  /** 旧版本解析的论文没有该字段，打开时从原 PDF 补算 */
  boxes?: ChunkBox[];
}

export type JobStatus = "idle" | "running" | "done" | "error";

export interface Paper {
  id: string;
  title: string;
  fileName: string;
  size: number;
  pageCount: number;
  createdAt: number;
  file: Blob;
  oneLiner?: string;
  trajectory?: TrajectoryNode[];
  glossary?: GlossaryTerm[];
  embedStatus?: JobStatus;
}

/** 问答请求里携带的检索上下文 */
export interface RetrievedContext {
  ref: string;
  label: string;
  text: string;
}
