/** 主线程侧的 embedding 客户端：单例 Worker + 请求编号匹配 */

type Pending = { resolve: (v: number[][]) => void; reject: (e: Error) => void };

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, Pending>();
const progressListeners = new Set<(p: number) => void>();

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL("./embed.worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (e) => {
    const msg = e.data;
    if (msg.type === "progress") {
      progressListeners.forEach((fn) => fn(msg.progress));
      return;
    }
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    if (msg.type === "result") p.resolve(msg.vectors);
    else p.reject(new Error(msg.message));
  };
  return worker;
}

export function embed(texts: string[], kind: "query" | "passage"): Promise<number[][]> {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ id, texts, kind, hfHost: process.env.NEXT_PUBLIC_HF_ENDPOINT });
  });
}

/** 监听模型下载进度（0-100），返回取消函数 */
export function onModelProgress(fn: (p: number) => void) {
  progressListeners.add(fn);
  return () => progressListeners.delete(fn);
}

export function cosine(a: number[], b: number[]) {
  // 向量已归一化，点积即余弦相似度
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}
