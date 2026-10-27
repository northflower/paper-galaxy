"use client";

import { FileUp, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import clsx from "clsx";
import { db } from "@/lib/db";
import { importPdf } from "@/lib/pdf/import";

/** 示例论文：BERT（ACL Anthology，CC BY 4.0），没有 PDF 在手时一键体验 */
const SAMPLE = { url: "/samples/bert.pdf", name: "BERT.pdf", label: "BERT" };

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
    try {
      setProgress("正在读取论文…");
      const id = await importPdf(file, (p, total) => setProgress(`正在解析第 ${p}/${total} 页…`));
      router.push(`/paper/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "解析失败，请换一个文件试试");
      setProgress(null);
    }
  };

  // 示例论文已导入过就直接打开，避免重复
  const openSample = async () => {
    if (busy) return;
    const existing = await db.papers.filter((p) => p.fileName === SAMPLE.name).first();
    if (existing) return router.push(`/paper/${existing.id}`);
    setError(null);
    setProgress("正在下载示例论文…");
    try {
      const res = await fetch(SAMPLE.url);
      if (!res.ok) throw new Error("示例论文下载失败");
      await handleFile(new File([await res.blob()], SAMPLE.name, { type: "application/pdf" }));
    } catch (err) {
      setError((err as Error).message);
      setProgress(null);
    }
  };

  const busy = progress !== null && !error;

  return (
    <div>
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
          "bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.01))] shadow-[0_30px_80px_-30px_rgba(0,0,0,0.9)] backdrop-blur-xl",
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
      <p className="mt-3 text-center text-xs text-faint">
        手边没有论文？
        <button onClick={openSample} disabled={busy} className="ml-1 text-accent/90 transition hover:text-accent disabled:opacity-50">
          试读示例：{SAMPLE.label} →
        </button>
      </p>
    </div>
  );
}
