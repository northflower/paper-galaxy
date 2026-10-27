// 把端侧 embedding 模型下载到 public/models，随应用一起部署，避免用户访问 HuggingFace 过慢
// 用法：node scripts/download-model.mjs        （国内可先设置 HF_ENDPOINT=https://hf-mirror.com）
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const MODEL = "Xenova/multilingual-e5-small";
const FILES = ["config.json", "tokenizer.json", "tokenizer_config.json", "special_tokens_map.json", "onnx/model_quantized.onnx"];
const endpoint = (process.env.HF_ENDPOINT ?? "https://huggingface.co").replace(/\/$/, "");
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "models", MODEL);

for (const file of FILES) {
  const dest = join(root, file);
  if (existsSync(dest)) {
    console.log(`跳过（已存在）${file}`);
    continue;
  }
  const url = `${endpoint}/${MODEL}/resolve/main/${file}`;
  console.log(`下载 ${url}`);
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`  失败：${res.status}`);
    process.exitCode = 1;
    continue;
  }
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  console.log(`  完成 ${(Number(res.headers.get("content-length") ?? 0) / 1e6).toFixed(1)} MB`);
}
