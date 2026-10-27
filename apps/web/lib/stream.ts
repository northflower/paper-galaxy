import { aiHeaders } from "@/stores/settings";

/** 读取后端的纯文本流，逐段回调；后端返回 JSON 错误时抛出其中的 message */
export async function readTextStream(
  res: Response,
  onDelta: (full: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  if (!res.ok || !res.body) throw new Error(await errorMessage(res));
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let full = "";
  while (true) {
    if (signal?.aborted) {
      await reader.cancel();
      break;
    }
    const { done, value } = await reader.read();
    if (done) break;
    full += decoder.decode(value, { stream: true });
    onDelta(full);
  }
  if (!full.trim()) throw new Error("AI 没有返回内容，请稍后重试");
  return full;
}

export async function postJson<T>(url: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...aiHeaders() },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return res.json() as Promise<T>;
}

export function postStream(url: string, body: unknown, signal?: AbortSignal) {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...aiHeaders() },
    body: JSON.stringify(body),
    signal,
  });
}

async function errorMessage(res: Response) {
  try {
    const data = await res.json();
    return data.error ?? `请求失败（${res.status}）`;
  } catch {
    return `请求失败（${res.status}）`;
  }
}
