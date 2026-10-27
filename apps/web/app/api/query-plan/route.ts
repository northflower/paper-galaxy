import { generateObject } from "ai";
import { z } from "zod";
import { errorResponse, getModel, readLlmConfig } from "@/lib/ai/provider";
import { QUERY_PLAN_SYSTEM } from "@/lib/ai/prompts";
import { queryPlanSchema } from "@/lib/types";

const bodySchema = z.object({ question: z.string().min(1).max(2000), title: z.string().default("") });

/** 查询改写：把中文提问转成英文检索词，解决中文问题检索英文原文时关键词检索失效的问题 */
export async function POST(req: Request) {
  const llm = readLlmConfig(req);
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) return Response.json({ error: "参数错误" }, { status: 400 });

  try {
    const { object } = await generateObject({
      model: getModel("fast", llm),
      schema: queryPlanSchema,
      system: QUERY_PLAN_SYSTEM,
      prompt: `论文标题：${parsed.data.title}\n用户问题：${parsed.data.question}\n请输出 JSON。`,
      temperature: 0,
    });
    return Response.json(object);
  } catch (err) {
    return errorResponse(err);
  }
}
