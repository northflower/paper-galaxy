import { generateObject } from "ai";
import { z } from "zod";
import { errorResponse, getModel, withRetry, readLlmConfig } from "@/lib/ai/provider";
import { TRAJECTORY_SYSTEM } from "@/lib/ai/prompts";
import { trajectorySchema, TRAJECTORY_TYPES } from "@/lib/types";

const bodySchema = z.object({
  title: z.string().default(""),
  paragraphs: z.array(z.object({ ref: z.string(), section: z.string(), text: z.string() })).min(1).max(800),
});

/** 单次请求的原文预算（字符），超出时按比例截断每段 */
const BUDGET = 48000;

export const maxDuration = 60;

/** 研究轨迹拆解：把论文论证链条结构化，并绑定原文段落作为证据 */
export async function POST(req: Request) {
  const llm = readLlmConfig(req);
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) return Response.json({ error: "参数错误" }, { status: 400 });
  const { title, paragraphs } = parsed.data;

  const total = paragraphs.reduce((n, p) => n + p.text.length, 0);
  const perPara = total > BUDGET ? Math.max(120, Math.floor(BUDGET / paragraphs.length)) : Infinity;
  let lastSection = "";
  const body = paragraphs
    .map((p) => {
      const header = p.section !== lastSection ? `\n## ${p.section}\n` : "";
      lastSection = p.section;
      const text = p.text.length > perPara ? `${p.text.slice(0, perPara)}…` : p.text;
      return `${header}[${p.ref}] ${text}`;
    })
    .join("\n");

  try {
    const { object } = await withRetry(() =>
      generateObject({
        model: getModel("chat", llm),
        schema: trajectorySchema,
        system: TRAJECTORY_SYSTEM,
        prompt: `论文标题：${title}\n\n论文正文（方括号内为段落编号）：\n${body}\n\n请输出 JSON。`,
        temperature: 0.3,
      }),
    );

    // 可控性：剔除模型编造的段落编号，保证每条证据都能在原文中定位
    const validRefs = new Set(paragraphs.map((p) => p.ref));
    const order = new Map(TRAJECTORY_TYPES.map((t, i) => [t, i]));
    const nodes = object.nodes
      .map((n) => ({ ...n, evidence: n.evidence.filter((r) => validRefs.has(r)).slice(0, 3) }))
      .sort((a, b) => (order.get(a.type) ?? 0) - (order.get(b.type) ?? 0));

    return Response.json({ oneLiner: object.oneLiner, nodes });
  } catch (err) {
    return errorResponse(err);
  }
}
