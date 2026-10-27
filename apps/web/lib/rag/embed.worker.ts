/// <reference lib="webworker" />
/**
 * 端侧向量化 Worker：在浏览器中用 Transformers.js 运行多语种 embedding 模型，
 * 论文内容不出本机，同时避免阻塞主线程渲染。
 * 运行时从 CDN 加载库，不进入主包体积。
 */

const TRANSFORMERS_URL = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.0";
const MODEL_ID = "Xenova/multilingual-e5-small";

type Extractor = (texts: string[], opts: { pooling: "mean"; normalize: boolean }) => Promise<{ tolist(): number[][] }>;

let extractorPromise: Promise<Extractor> | null = null;

function getExtractor(hfHost?: string) {
  extractorPromise ??= (async () => {
    const url = TRANSFORMERS_URL;
    const { pipeline, env } = await import(/* webpackIgnore: true */ url);
    // 优先加载随应用部署的模型（scripts/download-model.mjs 下载到 public/models），失败再走远程
    env.allowLocalModels = true;
    env.localModelPath = `${self.location.origin}/models/`;
    // 国内网络可通过 NEXT_PUBLIC_HF_ENDPOINT 指向镜像站
    if (hfHost) env.remoteHost = hfHost.endsWith("/") ? hfHost : `${hfHost}/`;
    // 模型由多个文件组成，按字节汇总成整体下载进度
    const files = new Map<string, { loaded: number; total: number }>();
    return pipeline("feature-extraction", MODEL_ID, {
      dtype: "q8",
      progress_callback: (p: { status: string; file?: string; loaded?: number; total?: number }) => {
        if (p.status !== "progress" || !p.file || !p.total) return;
        files.set(p.file, { loaded: p.loaded ?? 0, total: p.total });
        let loaded = 0;
        let total = 0;
        for (const f of files.values()) {
          loaded += f.loaded;
          total += f.total;
        }
        self.postMessage({ type: "progress", progress: (loaded / total) * 100 });
      },
    }) as Promise<Extractor>;
  })();
  return extractorPromise;
}

self.onmessage = async (e: MessageEvent<{ id: number; texts: string[]; kind: "query" | "passage"; hfHost?: string }>) => {
  const { id, texts, kind, hfHost } = e.data;
  try {
    const extractor = await getExtractor(hfHost);
    // e5 系列模型要求 query/passage 前缀
    const output = await extractor(
      texts.map((t) => `${kind}: ${t}`),
      { pooling: "mean", normalize: true },
    );
    self.postMessage({ type: "result", id, vectors: output.tolist() });
  } catch (err) {
    extractorPromise = null;
    self.postMessage({ type: "error", id, message: err instanceof Error ? err.message : String(err) });
  }
};
