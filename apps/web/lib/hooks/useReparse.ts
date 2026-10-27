"use client";

import { useEffect, useRef, useState } from "react";
import { db } from "../db";
import { parsePdf, PARSER_VERSION } from "../pdf/parse";
import type { Chunk, Paper } from "../types";

/**
 * 解析规则升级后，旧论文打开时从本地保存的 PDF 原件重新解析。
 * 段落文本不变的保留原译文和向量；段落编号会变，论证脉络与问答记录的引用随之失效，清空后重新生成。
 * 返回 true 表示段落已是最新，可以启动 AI 预处理。
 */
export function useReparse(paper: Paper | undefined) {
  const [busy, setBusy] = useState(false);
  const started = useRef<string | null>(null);
  const stale = !!paper?.file && (paper.parserVersion ?? 1) < PARSER_VERSION;

  useEffect(() => {
    if (!paper || !stale || started.current === paper.id) return;
    started.current = paper.id;
    setBusy(true);
    void (async () => {
      try {
        const [parsed, old] = await Promise.all([parsePdf(paper.file), db.chunks.where("paperId").equals(paper.id).toArray()]);
        const byText = new Map(old.map((c) => [c.text, c]));
        const chunks: Chunk[] = parsed.chunks.map((c) => {
          const prev = byText.get(c.text);
          return { ...c, id: `${paper.id}_${c.order}`, paperId: paper.id, translation: prev?.translation, embedding: prev?.embedding };
        });
        await db.transaction("rw", db.papers, db.chunks, async () => {
          await db.chunks.where("paperId").equals(paper.id).delete();
          await db.chunks.bulkAdd(chunks);
          await db.papers.update(paper.id, {
            parserVersion: PARSER_VERSION,
            pageCount: parsed.pageCount,
            trajectory: undefined,
            oneLiner: undefined,
            chat: undefined,
          });
        });
      } catch (err) {
        console.warn("[reparse] 重新解析失败，继续使用旧数据", err);
        await db.papers.update(paper.id, { parserVersion: PARSER_VERSION });
      } finally {
        setBusy(false);
      }
    })();
  }, [paper, stale]);

  return { ready: !!paper && !stale && !busy, busy };
}
