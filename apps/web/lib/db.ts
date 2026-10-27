import Dexie, { type Table } from "dexie";
import type { Chunk, Paper } from "./types";

/** 本地优先：论文、段落、向量都存在浏览器 IndexedDB 中，不上传服务器 */
class PaperGalaxyDB extends Dexie {
  papers!: Table<Paper, string>;
  chunks!: Table<Chunk, string>;

  constructor() {
    super("paper-galaxy");
    this.version(1).stores({
      papers: "id, createdAt",
      chunks: "id, paperId, [paperId+order]",
    });
  }
}

export const db = new PaperGalaxyDB();

export function getChunks(paperId: string) {
  return db.chunks.where("[paperId+order]").between([paperId, Dexie.minKey], [paperId, Dexie.maxKey]).toArray();
}

export async function deletePaper(paperId: string) {
  await db.transaction("rw", db.papers, db.chunks, async () => {
    await db.chunks.where("paperId").equals(paperId).delete();
    await db.papers.delete(paperId);
  });
}

/** 段落在界面上的位置标签，如 “P3 · 2.1 Method” */
export function chunkLabel(chunk: Pick<Chunk, "page" | "section">) {
  return chunk.section ? `P${chunk.page} · ${chunk.section}` : `P${chunk.page}`;
}
