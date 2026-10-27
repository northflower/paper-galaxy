import { streamText } from "ai";
import { z } from "zod";
import { errorResponse, getModel } from "@/lib/ai/provider";
import { VISION_SYSTEM, visionPrompt } from "@/lib/ai/prompts";
import { clip } from "@/lib/ai/safety";

// 约 3MB 的 base64 图片上限，前端截图已压缩到 1280px 以内
const MAX_IMAGE = 4_000_000;

const bodySchema = z.object({
  image: z
    .string()
    .max(MAX_IMAGE)
    .regex(/^data:image\/(png|jpeg|webp);base64,/),
  page: z.number().int().min(1),
  title: z.string().max(300).default(""),
  context: z.string().max(6000).default(""),
});

export const maxDuration = 60;

/** 多模态讲解：把框选的图表 / 公式截图与本页原文一起交给视觉模型，流式输出讲解 */
export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) return Response.json({ error: "图片格式或大小不符合要求" }, { status: 400 });
  const { image, page, title, context } = parsed.data;
  // 以字节形式传图，避免 SDK 把 data URL 当作远程地址下载
  const [, mediaType, base64] = image.match(/^data:(image\/[a-z]+);base64,(.*)$/)!;

  try {
    const result = streamText({
      model: getModel("vision"),
      system: VISION_SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", image: Buffer.from(base64, "base64"), mediaType },
            { type: "text", text: visionPrompt(title, page, clip(context, 2500)) },
          ],
        },
      ],
      temperature: 0.3,
    });
    return result.toTextStreamResponse();
  } catch (err) {
    return errorResponse(err);
  }
}
