import { streamText } from "ai";
import { z } from "zod";
import { errorResponse, getModel, readLlmConfig } from "@/lib/ai/provider";
import { CHAT_SYSTEM, chatPrompt } from "@/lib/ai/prompts";
import { checkUserInput, clip } from "@/lib/ai/safety";

const bodySchema = z.object({
  question: z.string(),
  contexts: z.array(z.object({ ref: z.string(), label: z.string(), text: z.string() })).max(10),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() }))
    .max(12)
    .default([]),
});

export const maxDuration = 60;

/** 溯源问答：检索在浏览器端完成，这里只接收命中的片段并流式生成带引用的回答 */
export async function POST(req: Request) {
  const llm = readLlmConfig(req);
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) return Response.json({ error: "参数错误" }, { status: 400 });
  const { question, contexts, history } = parsed.data;

  const blocked = checkUserInput(question);
  if (blocked) return Response.json({ error: blocked }, { status: 400 });

  try {
    const result = streamText({
      model: getModel("chat", llm),
      system: CHAT_SYSTEM,
      messages: [
        ...history.map((m) => ({ role: m.role, content: clip(m.content, 1500) })),
        { role: "user" as const, content: chatPrompt(question, contexts.map((c) => ({ ...c, text: clip(c.text, 1800) }))) },
      ],
      temperature: 0.3,
    });
    return result.toTextStreamResponse();
  } catch (err) {
    return errorResponse(err);
  }
}
