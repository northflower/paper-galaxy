/// <reference lib="webworker" />
/**
 * UMAP 降维 Worker：把 384 维段落向量降到三维星系坐标。
 * 每隔若干轮把中间结果发回主线程，界面上就能看到星星从混沌中聚成星云。
 */
import { UMAP } from "umap-js";

const FRAMES = 40;

/** 固定随机种子，同一批论文每次打开得到相同的星系形状 */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

self.onmessage = (e: MessageEvent<{ id: number; vectors: number[][] }>) => {
  const { id, vectors } = e.data;
  try {
    const n = vectors.length;
    const umap = new UMAP({
      nComponents: 3,
      nNeighbors: Math.max(2, Math.min(15, n - 1)),
      minDist: 0.15,
      spread: 1.2,
      random: mulberry32(42),
    });
    const epochs = umap.initializeFit(vectors);
    const every = Math.max(1, Math.floor(epochs / FRAMES));
    for (let i = 0; i < epochs; i++) {
      umap.step();
      if (i % every === 0 || i === epochs - 1) {
        self.postMessage({ type: "frame", id, positions: normalize(umap.getEmbedding()), progress: (i + 1) / epochs });
      }
    }
    self.postMessage({ type: "done", id });
  } catch (err) {
    self.postMessage({ type: "error", id, message: err instanceof Error ? err.message : String(err) });
  }
};

/** 平移到原点并缩放到固定半径，便于相机取景（用 95 分位半径，避免离群点把星系压扁） */
function normalize(points: number[][]): Float32Array {
  const n = points.length;
  const c = [0, 0, 0];
  for (const p of points) for (let k = 0; k < 3; k++) c[k] += p[k] / n;
  const dists = points.map((p) => Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2])).sort((a, b) => a - b);
  const r = dists[Math.floor((n - 1) * 0.95)] ?? 0;
  const scale = r > 0 ? 10 / r : 1;
  const out = new Float32Array(n * 3);
  points.forEach((p, i) => {
    for (let k = 0; k < 3; k++) out[i * 3 + k] = (p[k] - c[k]) * scale;
  });
  return out;
}
