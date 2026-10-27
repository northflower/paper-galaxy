"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { db } from "../db";
import { embed, onModelProgress } from "../rag/embedder";
import { postJson } from "../stream";
import type { Chunk, GlossaryTerm, JobStatus, Paper, TrajectoryNode } from "../types";

interface JobState {
  status: JobStatus;
  error?: string;
}

const EMBED_BATCH = 16;

/**
 * 论文打开后的 AI 预处理流水线（结果持久化，只跑一次）：
 * 术语表抽取 ∥ 研究轨迹拆解 ∥ 端侧向量化
 */
export function usePaperAnalysis(paper: Paper | undefined, chunks: Chunk[] | undefined) {
  const [glossary, setGlossary] = useState<JobState>({ status: "idle" });
  const [trajectory, setTrajectory] = useState<JobState>({ status: "idle" });
  const [embedding, setEmbedding] = useState<JobState & { progress: number }>({ status: "idle", progress: 0 });
  const started = useRef<string | null>(null);

  const body = chunks?.filter((c) => c.kind === "paragraph") ?? [];

  const runGlossary = useCallback(async () => {
    if (!paper || !chunks) return;
    setGlossary({ status: "running" });
    try {
      // 取标题、摘要、引言、方法部分的前约 1.4 万字，覆盖大部分核心术语
      const text = chunks
        .filter((c) => c.kind === "paragraph")
        .map((c) => c.text)
        .join("\n")
        .slice(0, 14000);
      const { terms } = await postJson<{ terms: GlossaryTerm[] }>("/api/glossary", { title: paper.title, text });
      await db.papers.update(paper.id, { glossary: terms });
      setGlossary({ status: "done" });
    } catch (err) {
      setGlossary({ status: "error", error: (err as Error).message });
    }
  }, [paper, chunks]);

  const runTrajectory = useCallback(async () => {
    if (!paper || !chunks) return;
    setTrajectory({ status: "running" });
    try {
      const paragraphs = chunks
        .filter((c) => c.kind === "paragraph")
        .map((c) => ({ ref: c.ref, section: c.section, text: c.text }));
      const res = await postJson<{ oneLiner: string; nodes: TrajectoryNode[] }>("/api/trajectory", {
        title: paper.title,
        paragraphs,
      });
      await db.papers.update(paper.id, { trajectory: res.nodes, oneLiner: res.oneLiner });
      setTrajectory({ status: "done" });
    } catch (err) {
      setTrajectory({ status: "error", error: (err as Error).message });
    }
  }, [paper, chunks]);

  const runEmbedding = useCallback(async () => {
    if (!paper || !chunks) return;
    const todo = chunks.filter((c) => !c.embedding && (c.kind === "paragraph" || c.kind === "heading"));
    if (!todo.length) {
      setEmbedding({ status: "done", progress: 100 });
      return;
    }
    setEmbedding({ status: "running", progress: 0 });
    await db.papers.update(paper.id, { embedStatus: "running" });
    const off = onModelProgress((p) =>
      setEmbedding((s) => ({ ...s, progress: Math.max(s.progress, Math.min(p, 99) * 0.3) })),
    );
    try {
      for (let i = 0; i < todo.length; i += EMBED_BATCH) {
        const batch = todo.slice(i, i + EMBED_BATCH);
        const vectors = await embed(batch.map((c) => c.text.slice(0, 1200)), "passage");
        await db.chunks.bulkUpdate(batch.map((c, j) => ({ key: c.id, changes: { embedding: vectors[j] } })));
        // 前 30% 进度留给模型下载
        setEmbedding({ status: "running", progress: 30 + ((i + batch.length) / todo.length) * 70 });
      }
      await db.papers.update(paper.id, { embedStatus: "done" });
      setEmbedding({ status: "done", progress: 100 });
    } catch (err) {
      await db.papers.update(paper.id, { embedStatus: "error" });
      setEmbedding({ status: "error", progress: 0, error: (err as Error).message });
    } finally {
      off();
    }
  }, [paper, chunks]);

  useEffect(() => {
    if (!paper || !chunks || started.current === paper.id) return;
    started.current = paper.id;
    if (paper.glossary) setGlossary({ status: "done" });
    else void runGlossary();
    if (paper.trajectory) setTrajectory({ status: "done" });
    else void runTrajectory();
    void runEmbedding();
  }, [paper, chunks, runGlossary, runTrajectory, runEmbedding]);

  return {
    glossary,
    trajectory,
    embedding,
    paragraphCount: body.length,
    retryGlossary: runGlossary,
    retryTrajectory: runTrajectory,
    retryEmbedding: runEmbedding,
  };
}
