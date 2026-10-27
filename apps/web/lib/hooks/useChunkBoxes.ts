"use client";

import { useEffect, useRef } from "react";
import { db } from "../db";
import { parsePdf } from "../pdf/parse";
import type { Chunk, ChunkBox, Paper } from "../types";

/**
 * 旧版本解析的论文没有段落位置信息：从本地保存的 PDF 原件重新解析一遍，
 * 按段落文本匹配补写位置，原有的译文、向量都保留。
 */
export function useChunkBoxes(paper: Paper | undefined, chunks: Chunk[] | undefined) {
  const done = useRef<string | null>(null);

  useEffect(() => {
    if (!paper?.file || !chunks || done.current === paper.id) return;
    const missing = chunks.filter((c) => c.kind !== "title" && !c.boxes);
    if (!missing.length) return;
    done.current = paper.id;

    void (async () => {
      try {
        const parsed = await parsePdf(paper.file);
        const byText = new Map<string, ChunkBox[]>();
        for (const c of parsed.chunks) if (c.boxes && !byText.has(c.text)) byText.set(c.text, c.boxes);
        const updates = missing.flatMap((c) => {
          const boxes = byText.get(c.text);
          return boxes ? [{ key: c.id, changes: { boxes } }] : [];
        });
        if (updates.length) await db.chunks.bulkUpdate(updates);
      } catch (err) {
        console.warn("[boxes] 补算段落位置失败", err);
      }
    })();
  }, [paper, chunks]);
}
