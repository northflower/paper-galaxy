import { generateText } from "ai";
import { errorResponse, getModel, readLlmConfig, serverConfigured } from "@/lib/ai/provider";

export const maxDuration = 30;

/** 服务端是否已配置默认模型（不返回任何密钥信息） */
export function GET() {
  return Response.json(serverConfigured());
}

/** 测试连接：用当前配置的快速模型生成一个极短回复 */
export async function POST(req: Request) {
  try {
    const { text } = await generateText({
      model: getModel("fast", readLlmConfig(req)),
      prompt: "只回复两个字：成功",
      maxOutputTokens: 16,
    });
    return Response.json({ ok: true, reply: text.trim().slice(0, 20) });
  } catch (err) {
    return errorResponse(err);
  }
}
