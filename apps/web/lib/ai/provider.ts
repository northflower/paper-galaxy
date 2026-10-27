import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

export class MissingKeyError extends Error {
  constructor() {
    super("还没有配置模型：请点击右上角“模型设置”填写接口地址、API Key 与模型名称");
  }
}

export class MissingVisionModelError extends MissingKeyError {
  constructor() {
    super();
    this.message = "还没有配置视觉模型：请在“模型设置”中填写支持图片输入的模型后再使用框选讲解";
  }
}

/** 用户在网页“模型设置”中填写的配置，随每次请求通过请求头传给服务端，服务端不保存 */
export interface LlmConfig {
  baseURL?: string;
  apiKey?: string;
  model?: string;
  fastModel?: string;
  visionModel?: string;
  /** 快速档关闭思考模式（在请求体中附加 enable_thinking: false） */
  disableThinking?: boolean;
}

export const LLM_HEADER = "x-pg-llm";

/** 读取请求头中的模型配置（UTF-8 JSON 的 base64），格式不对时忽略 */
export function readLlmConfig(req: Request): LlmConfig | undefined {
  const raw = req.headers.get(LLM_HEADER);
  if (!raw) return undefined;
  try {
    const cfg = JSON.parse(Buffer.from(raw, "base64").toString("utf8")) as LlmConfig;
    if (!cfg.apiKey?.trim()) return undefined;
    if (cfg.baseURL && !/^https?:\/\//.test(cfg.baseURL)) return undefined;
    return cfg;
  } catch {
    return undefined;
  }
}

/**
 * 统一走 OpenAI 兼容接口，任何兼容服务只需填写接口地址、Key 与模型名即可接入。
 * 优先使用网页中填写的配置；没有填写时使用服务端环境变量。
 * chat：问答、轨迹拆解等需要推理的任务；fast：翻译、检索改写、Agent 等高频任务；vision：图表讲解。
 */
export function getModel(kind: "chat" | "fast" | "vision" = "chat", user?: LlmConfig) {
  const env = process.env;
  const apiKey = user?.apiKey?.trim() || env.LLM_API_KEY;
  if (!apiKey) throw new MissingKeyError();
  // 网页配置与环境变量不混用，避免把用户的 Key 发到服务端默认的地址
  const baseURL = user ? user.baseURL?.trim() : env.LLM_BASE_URL?.trim();
  const chatModel = user ? user.model?.trim() : env.LLM_MODEL?.trim();
  if (!baseURL || !chatModel) throw new MissingKeyError();
  const fastModel = (user ? user.fastModel?.trim() : env.LLM_FAST_MODEL) || chatModel;
  const visionModel = user ? user.visionModel?.trim() : env.LLM_VISION_MODEL;

  if (kind === "vision") {
    if (!visionModel) throw new MissingVisionModelError();
    return createOpenAICompatible({ name: "llm", baseURL, apiKey })(visionModel);
  }

  // 额外请求参数，例如关闭思考模式：LLM_FAST_EXTRA_BODY={"enable_thinking":false}
  const extra = user
    ? kind === "fast" && user.disableThinking
      ? { enable_thinking: false }
      : undefined
    : parseExtraBody(kind === "chat" ? env.LLM_EXTRA_BODY : env.LLM_FAST_EXTRA_BODY);
  const provider = createOpenAICompatible({
    name: "llm",
    baseURL,
    apiKey,
    transformRequestBody: extra ? (body) => ({ ...body, ...extra }) : undefined,
  });
  return provider(kind === "chat" ? chatModel : fastModel);
}

/** 服务端是否配置了默认模型，供设置面板提示 */
export function serverConfigured() {
  return { chat: !!process.env.LLM_API_KEY, vision: !!(process.env.LLM_API_KEY && process.env.LLM_VISION_MODEL) };
}

function parseExtraBody(raw: string | undefined): Record<string, unknown> | undefined {
  if (!raw?.trim()) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    console.warn("[ai] 额外请求参数不是合法 JSON，已忽略");
    return undefined;
  }
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
  if (err instanceof MissingKeyError) return Response.json({ error: err.message }, { status: 503 });
  const status = (err as { statusCode?: number }).statusCode;
  // 只记录错误类型与状态码，不打印请求内容，避免泄露用户的 Key
  console.error("[ai]", (err as Error).name, status ?? "", (err as Error).message?.slice(0, 200));
  const message =
    status === 401 || status === 403
      ? "模型服务拒绝了请求：请检查 API Key 是否正确、是否有该模型的权限"
      : status === 404
        ? "模型或接口地址不存在：请检查接口地址与模型名称"
        : status === 429
          ? "请求过于频繁或额度不足，请稍后重试"
          : "AI 服务暂时不可用，请稍后重试";
  return Response.json({ error: message }, { status: 502 });
}
