/**
 * Small fetch wrapper that never throws: every failure (network, timeout,
 * HTTP status, 429 rate limit) comes back as a typed, human-readable error.
 */

export type ScholarErrorCode =
  | "RATE_LIMITED"
  | "NOT_FOUND"
  | "BAD_REQUEST"
  | "UPSTREAM_ERROR"
  | "NETWORK_ERROR"
  | "TIMEOUT"
  | "PARSE_ERROR";

export interface ScholarError {
  code: ScholarErrorCode;
  message: string;
  status?: number;
  retryAfterSeconds?: number;
  source: string;
}

export type Result<T> = { ok: true; data: T } | { ok: false; error: ScholarError };

export interface FetchOptions {
  source: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  /** Retries on 429 / 5xx, with a short backoff. */
  retries?: number;
}

const USER_AGENT = "PaperGalaxy-ScholarMCP/0.1 (+https://github.com/paper-galaxy)";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds);
  const date = Date.parse(value);
  if (!Number.isNaN(date)) return Math.max(0, Math.round((date - Date.now()) / 1000));
  return undefined;
}

export async function fetchText(url: string, opts: FetchOptions): Promise<Result<string>> {
  const { source, headers = {}, timeoutMs = 15_000, retries = 1 } = opts;

  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, ...headers },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      const isTimeout = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
      if (attempt < retries) {
        await sleep(800 * (attempt + 1));
        continue;
      }
      return {
        ok: false,
        error: isTimeout
          ? { code: "TIMEOUT", source, message: `${source} 请求超时（${timeoutMs / 1000}s），请稍后重试。` }
          : {
              code: "NETWORK_ERROR",
              source,
              message: `无法连接 ${source}：${err instanceof Error ? err.message : String(err)}`,
            },
      };
    }

    if (res.ok) {
      try {
        return { ok: true, data: await res.text() };
      } catch (err) {
        return {
          ok: false,
          error: { code: "NETWORK_ERROR", source, message: `读取 ${source} 响应失败：${String(err)}` },
        };
      }
    }

    const retryAfter = parseRetryAfter(res.headers.get("retry-after"));
    const retryable = res.status === 429 || res.status >= 500;
    if (retryable && attempt < retries) {
      // Cap the wait so a tool call never hangs for long.
      await sleep(Math.min((retryAfter ?? 1.5 * (attempt + 1)) * 1000, 5_000));
      continue;
    }

    let detail = "";
    try {
      detail = (await res.text()).slice(0, 300);
    } catch {
      /* ignore */
    }

    if (res.status === 429) {
      return {
        ok: false,
        error: {
          code: "RATE_LIMITED",
          source,
          status: 429,
          retryAfterSeconds: retryAfter,
          message:
            `${source} 触发限流（HTTP 429）` +
            (retryAfter !== undefined ? `，建议 ${retryAfter} 秒后重试` : "，请稍后重试") +
            (source === "Semantic Scholar" ? "。配置 SEMANTIC_SCHOLAR_API_KEY 可获得更高配额。" : "。"),
        },
      };
    }
    if (res.status === 404) {
      return { ok: false, error: { code: "NOT_FOUND", source, status: 404, message: `${source} 未找到该资源。` } };
    }
    if (res.status === 400) {
      return {
        ok: false,
        error: { code: "BAD_REQUEST", source, status: 400, message: `${source} 拒绝了请求参数：${detail}` },
      };
    }
    return {
      ok: false,
      error: {
        code: "UPSTREAM_ERROR",
        source,
        status: res.status,
        message: `${source} 返回 HTTP ${res.status}${detail ? `：${detail}` : ""}`,
      },
    };
  }
}

export async function fetchJson<T>(url: string, opts: FetchOptions): Promise<Result<T>> {
  const text = await fetchText(url, opts);
  if (!text.ok) return text;
  try {
    return { ok: true, data: JSON.parse(text.data) as T };
  } catch {
    return {
      ok: false,
      error: { code: "PARSE_ERROR", source: opts.source, message: `${opts.source} 返回的不是合法 JSON。` },
    };
  }
}
