import type { PDFDocumentProxy } from "pdfjs-dist";
import { loadPdfjs } from "./parse";

export interface PdfHandle {
  doc: PDFDocumentProxy;
  /** 每页在 scale = 1 时的尺寸（PDF 点） */
  sizes: { width: number; height: number }[];
}

// 同一篇论文只加载一次，阅读器内各页共享
const cache = new Map<string, Promise<PdfHandle>>();

export function openPdf(paperId: string, file: Blob): Promise<PdfHandle> {
  let task = cache.get(paperId);
  if (!task) {
    task = (async () => {
      const pdfjs = await loadPdfjs();
      const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
      const sizes = [];
      for (let p = 1; p <= doc.numPages; p++) {
        const vp = (await doc.getPage(p)).getViewport({ scale: 1 });
        sizes.push({ width: vp.width, height: vp.height });
      }
      return { doc, sizes };
    })();
    task.catch(() => cache.delete(paperId));
    cache.set(paperId, task);
  }
  return task;
}

export function closePdf(paperId: string) {
  const task = cache.get(paperId);
  cache.delete(paperId);
  void task?.then((h) => h.doc.destroy()).catch(() => {});
}
