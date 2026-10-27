import { db } from "@/lib/db";
import type { Chunk, Paper } from "@/lib/types";
import { parsePdf } from "./parse";

export const MAX_PDF_SIZE = 40 * 1024 * 1024;

/** 在浏览器内解析 PDF 并写入本地库，返回论文 id。上传与“试读示例”共用 */
export async function importPdf(file: File, onProgress?: (page: number, total: number) => void) {
  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    throw new Error("目前只支持 PDF 格式的论文");
  }
  if (file.size > MAX_PDF_SIZE) throw new Error("文件超过 40MB，请压缩后再上传");

  const parsed = await parsePdf(file, onProgress);
  if (parsed.chunks.filter((c) => c.kind === "paragraph").length < 3) {
    throw new Error("没有提取到正文文字，可能是扫描版 PDF（OCR 支持开发中）");
  }
  const id = crypto.randomUUID();
  const paper: Paper = {
    id,
    title: parsed.title || file.name.replace(/\.pdf$/i, ""),
    fileName: file.name,
    size: file.size,
    pageCount: parsed.pageCount,
    createdAt: Date.now(),
    file,
    embedStatus: "idle",
  };
  const chunks: Chunk[] = parsed.chunks.map((c) => ({ ...c, id: `${id}_${c.order}`, paperId: id }));
  await db.transaction("rw", db.papers, db.chunks, async () => {
    await db.papers.add(paper);
    await db.chunks.bulkAdd(chunks);
  });
  return id;
}
