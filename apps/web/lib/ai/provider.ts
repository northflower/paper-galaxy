import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

export class MissingKeyError extends Error {
  constructor() {
    super("服务端未配置 LLM_API_KEY，请参考 .env.example 配置模型密钥");
  }
}

/**
 * 统一走 OpenAI 兼容接口，DeepSeek / 通义千问 / 智谱 等只需改环境变量即可切换。
 * chat：问答、轨迹拆解等需要推理的任务；fast：翻译、检索改写等高频任务。
 */
export function getModel(kind: "chat" | "fast" = "chat") {
  const apiKey = process.env.LLM_API_KEY;
  if (!apiKey) throw new MissingKeyError();

  const provider = createOpenAICompatible({
    name: "llm",
    baseURL: process.env.LLM_BASE_URL ?? "https://api.deepseek.com/v1",
    apiKey,
  });
  const chatModel = process.env.LLM_MODEL ?? "deepseek-chat";
  const fastModel = process.env.LLM_FAST_MODEL ?? chatModel;
  return provider(kind === "chat" ? chatModel : fastModel);
}

/** 结构化输出偶尔不合 schema，自动重试一次 */
export async function withRetry<T>(fn: () => Promise<T>, times = 2): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < times; i++) {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof MissingKeyError) throw err;
      lastError = err;
    }
  }
  throw lastError;
}

/** API 路由统一错误响应，前端据 message 做友好兜底 */
export function errorResponse(err: unknown) {
  const isKey = err instanceof MissingKeyError;
  const message = isKey ? err.message : "AI 服务暂时不可用，请稍后重试";
  if (!isKey) console.error("[ai]", err);
  return Response.json({ error: message }, { status: isKey ? 503 : 502 });
}
