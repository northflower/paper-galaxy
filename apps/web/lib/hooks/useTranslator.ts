"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { db } from "../db";
import { postStream, readTextStream } from "../stream";
import type { Chunk, GlossaryTerm } from "../types";

const CONCURRENCY = 3;

/** 只把在本段出现过的术语注入 Prompt：既保证译名一致，又控制 token 开销 */
export function termsFor(text: string, glossary: GlossaryTerm[]) {
  const lower = text.toLowerCase();
  return glossary.filter((t) => lower.includes(t.term.toLowerCase())).map(({ term, translation }) => ({ term, translation }));
}

/**
 * 懒加载翻译队列：段落进入可视区域才请求，限制并发，流式展示，完成后写入 IndexedDB 缓存。
 * 术语表就绪（或失败）前暂停，保证首批译文也遵循术语表。
 */
export function useTranslator(glossary: GlossaryTerm[] | undefined, ready: boolean) {
  const [streaming, setStreaming] = useState<Record<string, string>>({});
  const [failed, setFailed] = useState<Record<string, string>>({});
  const queue = useRef<Chunk[]>([]);
  const active = useRef(0);
  const requested = useRef(new Set<string>());
  const glossaryRef = useRef(glossary ?? []);
  const readyRef = useRef(ready);
  glossaryRef.current = glossary ?? [];
  readyRef.current = ready;

  const pump = useCallback(() => {
    while (readyRef.current && active.current < CONCURRENCY && queue.current.length) {
      const chunk = queue.current.shift()!;
      active.current++;
      void (async () => {
        try {
          const res = await postStream("/api/translate", {
            text: chunk.text,
            section: chunk.section,
            terms: termsFor(chunk.text, glossaryRef.current),
          });
          const full = await readTextStream(res, (t) => setStreaming((s) => ({ ...s, [chunk.id]: t })));
          await db.chunks.update(chunk.id, { translation: full.trim() });
        } catch (err) {
          requested.current.delete(chunk.id);
          setFailed((f) => ({ ...f, [chunk.id]: (err as Error).message }));
        } finally {
          setStreaming((s) => {
            const next = { ...s };
            delete next[chunk.id];
            return next;
          });
          active.current--;
          pump();
        }
      })();
    }
  }, []);

  useEffect(() => {
    if (ready) pump();
  }, [ready, pump]);

  const request = useCallback(
    (chunk: Chunk) => {
      if (chunk.translation || requested.current.has(chunk.id)) return;
      requested.current.add(chunk.id);
      setFailed((f) => {
        if (!(chunk.id in f)) return f;
        const next = { ...f };
        delete next[chunk.id];
        return next;
      });
      queue.current.push(chunk);
      pump();
    },
    [pump],
  );

  return { streaming, failed, request };
}
