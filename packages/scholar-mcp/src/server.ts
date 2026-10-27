import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { searchArxiv } from "./arxiv.js";
import type { Result } from "./http.js";
import { getCitations, getPaper, getReferences } from "./semanticScholar.js";

export const SERVER_NAME = "paper-galaxy-scholar";
export const SERVER_VERSION = "0.1.0";

function toToolResult<T>(result: Result<T>): CallToolResult {
  if (result.ok) {
    return { content: [{ type: "text", text: JSON.stringify(result.data, null, 2) }] };
  }
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify({ error: result.error }, null, 2) }],
  };
}

/** Last line of defence: a tool handler must never reject. */
async function safely<T>(run: () => Promise<Result<T>>): Promise<CallToolResult> {
  try {
    return toToolResult(await run());
  } catch (err) {
    return toToolResult({
      ok: false,
      error: {
        code: "UPSTREAM_ERROR",
        source: SERVER_NAME,
        message: `工具执行出现意外错误：${err instanceof Error ? err.message : String(err)}`,
      },
    });
  }
}

const paperIdSchema = z
  .string()
  .min(1)
  .describe(
    "论文标识：arXiv id（如 1706.03762）、DOI（如 10.18653/v1/N19-1423）、Semantic Scholar paperId、CorpusId:xxx，或 arXiv / DOI 链接",
  );
const limitSchema = z.number().int().min(1).max(100).default(20).describe("返回条数，1–100，默认 20");
const offsetSchema = z.number().int().min(0).default(0).describe("分页偏移，默认 0；可使用上次结果中的 next");
const includeAbstractSchema = z.boolean().default(false).describe("是否附带每篇论文的摘要（会显著增加输出长度）");

export function createScholarServer(): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      instructions:
        "学术检索工具：search_arxiv 按关键词搜索 arXiv；get_paper 获取论文详情（含 TLDR、引用数）；" +
        "get_references 查前置论文（该论文引用了谁）；get_citations 查后续工作（谁引用了该论文）。" +
        "所有工具返回 JSON 文本；失败时 isError=true 且包含 error.code / error.message。",
    },
  );

  server.registerTool(
    "search_arxiv",
    {
      title: "搜索 arXiv",
      description:
        "按关键词搜索 arXiv 论文，返回 id、标题、作者、摘要、发表日期与 PDF 链接。" +
        "普通文本会按词 AND 匹配全部字段；也支持 arXiv 原生语法，如 ti:transformer AND au:vaswani、cat:cs.CL。",
      inputSchema: {
        query: z.string().min(1).describe("检索词，例如 \"retrieval augmented generation\" 或 ti:diffusion AND cat:cs.CV"),
        max_results: z.number().int().min(1).max(50).default(10).describe("返回条数，1–50，默认 10"),
        sort_by: z
          .enum(["relevance", "submittedDate", "lastUpdatedDate"])
          .default("relevance")
          .describe("排序方式，默认 relevance"),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    ({ query, max_results, sort_by }) => safely(() => searchArxiv(query, max_results, sort_by)),
  );

  server.registerTool(
    "get_paper",
    {
      title: "获取论文详情",
      description: "通过 Semantic Scholar 获取论文详情：标题、作者、摘要、年份、会议/期刊、引用数、TLDR、开放获取 PDF。",
      inputSchema: { id_or_doi: paperIdSchema },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    ({ id_or_doi }) => safely(() => getPaper(id_or_doi)),
  );

  server.registerTool(
    "get_references",
    {
      title: "前置论文",
      description:
        "列出该论文引用的文献（前置论文 / 研究基础），附带引用意图（background / methodology / result）与是否为高影响引用。",
      inputSchema: {
        paper_id: paperIdSchema,
        limit: limitSchema,
        offset: offsetSchema,
        include_abstract: includeAbstractSchema,
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    ({ paper_id, limit, offset, include_abstract }) =>
      safely(() => getReferences(paper_id, limit, offset, include_abstract)),
  );

  server.registerTool(
    "get_citations",
    {
      title: "后续工作",
      description: "列出引用了该论文的文献（后续工作 / 跟进研究），附带引用上下文片段与引用意图。",
      inputSchema: {
        paper_id: paperIdSchema,
        limit: limitSchema,
        offset: offsetSchema,
        include_abstract: includeAbstractSchema,
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    ({ paper_id, limit, offset, include_abstract }) =>
      safely(() => getCitations(paper_id, limit, offset, include_abstract)),
  );

  return server;
}
