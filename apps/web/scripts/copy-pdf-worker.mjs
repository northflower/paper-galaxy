// 将 pdf.js 的 worker 复制到 public，避免打包器处理 worker 时的兼容问题
import { copyFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
try {
  const pkgDir = dirname(require.resolve("pdfjs-dist/package.json"));
  const src = join(pkgDir, "build", "pdf.worker.min.mjs");
  if (existsSync(src)) copyFileSync(src, new URL("../public/pdf.worker.min.mjs", import.meta.url));
} catch (err) {
  console.warn("[copy-pdf-worker] skipped:", err.message);
}
