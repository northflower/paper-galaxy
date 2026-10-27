import { streamText } from "ai";
import { z } from "zod";
import { errorResponse, getModel, readLlmConfig } from "@/lib/ai/provider";
import { TRANSLATE_SYSTEM, translatePrompt } from "@/lib/ai/prompts";
import { clip } from "@/lib/ai/safety";

const bodySchema = z.object({
  text: z.string().min(1).max(6000),
  section: z.string().default(""),
  terms: z.array(z.object({ term: z.string(), translation: z.string() })).max(40).default([]),
});

/** 段落级流式翻译：前端按可视区域懒加载调用，并把结果缓存到 IndexedDB */
export async function POST(req: Request) {
  const llm = readLlmConfig(req);
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) return Response.json({ error: "参数错误" }, { status: 400 });
  const { text, section, terms } = parsed.data;

  try {
    const result = streamText({
      model: getModel("fast", llm),
      system: TRANSLATE_SYSTEM,
      prompt: translatePrompt(clip(text, 6000), section, terms),
      temperature: 0.2,
    });
    return result.toTextStreamResponse();
  } catch (err) {
    return errorResponse(err);
  }
}
