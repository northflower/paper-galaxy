import { TRAJECTORY_META, type Chunk, type Paper } from "./types";

/**
 * 导出双语 Markdown：一句话概括、论文脉络、正文（译文在前，原文以引用块附后）、术语表。
 * 未翻译的段落保留原文，方便导入笔记软件继续整理。
 */
export function exportMarkdown(paper: Paper, chunks: Chunk[]) {
  const out: string[] = [`# ${paper.title}`, ""];
  if (paper.oneLiner) out.push(`> ${paper.oneLiner}`, "");

  if (paper.trajectory?.length) {
    out.push("## 论文脉络", "");
    for (const n of paper.trajectory) out.push(`- **${TRAJECTORY_META[n.type].label} · ${n.title}**：${n.summary}`);
    out.push("");
  }

  out.push("## 正文", "");
  for (const c of chunks) {
    if (c.kind === "heading") out.push(`### ${c.text}`, "");
    else if (c.kind === "paragraph") {
      if (c.translation) out.push(c.translation, "", ...quote(c.text), "");
      else out.push(c.text, "");
    }
  }

  if (paper.glossary?.length) {
    out.push("## 术语表", "", "| 术语 | 译名 | 解释 |", "|---|---|---|");
    for (const t of paper.glossary) out.push(`| ${cell(t.term)} | ${cell(t.translation)} | ${cell(t.explanation)} |`);
    out.push("");
  }
  out.push("---", "由论文星图 PaperGalaxy 生成，AI 译文仅供参考，请以原文为准。");

  const blob = new Blob([out.join("\n")], { type: "text/markdown;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${paper.title.replace(/[\/:*?"<>|]/g, " ").slice(0, 80)}.双语.md`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const quote = (text: string) => text.split("\n").map((l) => `> ${l}`);
const cell = (s: string) => s.replace(/\|/g, "\|").replace(/\n/g, " ");
