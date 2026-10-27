import { generateObject } from "ai";
import { z } from "zod";
import { errorResponse, getModel, withRetry } from "@/lib/ai/provider";
import { GLOSSARY_SYSTEM } from "@/lib/ai/prompts";
import { clip } from "@/lib/ai/safety";
import { glossarySchema } from "@/lib/types";

const bodySchema = z.object({ title: z.string().default(""), text: z.string().min(1) });

/** 抽取论文术语表：之后翻译时按段落检索命中的术语注入 Prompt，保证全文译名一致 */
export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) return Response.json({ error: "参数错误" }, { status: 400 });

  try {
    const { object } = await withRetry(() =>
      generateObject({
        model: getModel("fast"),
        schema: glossarySchema,
        system: GLOSSARY_SYSTEM,
        prompt: `论文标题：${parsed.data.title}\n\n论文片段：\n${clip(parsed.data.text, 14000)}\n\n请输出 JSON。`,
        temperature: 0.1,
      }),
    );
    // 去重，并过滤掉过短的伪术语
    const seen = new Set<string>();
    const terms = object.terms.filter((t) => {
      const key = t.term.trim().toLowerCase();
      if (key.length < 2 || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return Response.json({ terms });
  } catch (err) {
    return errorResponse(err);
  }
}
