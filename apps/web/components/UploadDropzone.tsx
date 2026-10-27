"use client";

import { FileUp, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import clsx from "clsx";
import { db } from "@/lib/db";
import { parsePdf } from "@/lib/pdf/parse";
import type { Chunk, Paper } from "@/lib/types";

const MAX_SIZE = 40 * 1024 * 1024;

/** 拖拽上传 PDF，在浏览器内完成解析并写入本地库，随后进入阅读器 */
export function UploadDropzone() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      setError("目前只支持 PDF 格式的论文");
      return;
    }
    if (file.size > MAX_SIZE) {
      setError("文件超过 40MB，请压缩后再上传");
      return;
    }
    try {
      setProgress("正在读取论文…");
      const parsed = await parsePdf(file, (p, total) => setProgress(`正在解析第 ${p}/${total} 页…`));
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
      router.push(`/paper/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "解析失败，请换一个文件试试");
      setProgress(null);
    }
  };

  const busy = progress !== null && !error;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => !busy && inputRef.current?.click()}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        void handleFile(e.dataTransfer.files[0]);
      }}
      className={clsx(
        "glass group relative flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-dashed px-6 py-12 text-center transition",
        dragging ? "border-accent shadow-[0_0_48px_-12px_var(--glow)]" : "hover:border-line-strong",
      )}
    >
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={(e) => {
          void handleFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-accent/15 text-accent transition group-hover:scale-110">
        {busy ? <Loader2 className="h-6 w-6 animate-spin" /> : <FileUp className="h-6 w-6" />}
      </div>
      <div className="text-base font-medium">{busy ? progress : "拖入论文 PDF，或点击选择文件"}</div>
      <div className="text-sm text-muted">解析在浏览器本地完成，论文原件不会上传到服务器</div>
      {error && <div className="mt-1 text-sm text-red-300">{error}</div>}
    </div>
  );
}
