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
        "group relative flex cursor-pointer items-center gap-4 rounded-2xl border px-5 py-5 text-left transition duration-200 sm:px-6",
        "bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.01))]",
        dragging
          ? "border-accent/60 shadow-[0_0_0_4px_rgba(163,177,255,0.08),0_24px_80px_-24px_var(--glow)]"
          : "border-line hover:border-line-strong",
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
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-line bg-white/[0.03] text-accent transition group-hover:border-line-strong">
        {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <FileUp className="h-5 w-5" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[15px] font-medium">{busy ? progress : "上传论文"}</div>
        <div className={clsx("mt-0.5 text-[13px]", error ? "text-red-300" : "text-faint")}>
          {error ?? (busy ? "在浏览器本地解析，文件不会上传" : "拖入 PDF，或点击选择文件")}
        </div>
      </div>
      <span className="hidden shrink-0 rounded-md border border-line px-2 py-1 font-mono text-[11px] text-faint sm:block">PDF</span>
    </div>
  );
}
