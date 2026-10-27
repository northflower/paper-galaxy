# @paper-galaxy/scholar-mcp

论文星图 PaperGalaxy 的学术检索 MCP 服务器。Web 端的「学者 Agent」通过 MCP client 连接它，用来查找一篇论文的**前置论文**、**后续工作**和**相关方法**。

- 数据源：[arXiv API](https://info.arxiv.org/help/api/) + [Semantic Scholar Graph API](https://api.semanticscholar.org/api-docs/graph)
- 基于 `@modelcontextprotocol/sdk`，stdio 传输；同时导出 `createScholarServer()`，可在 Node 进程内直接使用
- 所有工具输入用 zod 定义，输出为结构化 JSON 文本
- 网络错误、超时、429 限流都会返回 `isError: true` 的友好错误，**不会抛异常**

## 工具

| 工具 | 输入 | 说明 |
| --- | --- | --- |
| `search_arxiv` | `query`，`max_results`（1–50，默认 10），`sort_by`（`relevance` / `submittedDate` / `lastUpdatedDate`） | 搜索 arXiv，返回 id、标题、作者、摘要、发表日期、PDF 链接、分类等 |
| `get_paper` | `id_or_doi` | Semantic Scholar 论文详情：标题、作者、摘要、年份、会议、引用数、高影响引用数、TLDR、开放获取 PDF |
| `get_references` | `paper_id`，`limit`（1–100，默认 20），`offset`，`include_abstract` | **前置论文**：该论文引用了哪些工作，附引用意图与是否高影响 |
| `get_citations` | `paper_id`，`limit`，`offset`，`include_abstract` | **后续工作**：哪些论文引用了它，附引用上下文片段 |

`id_or_doi` / `paper_id` 可接受多种写法，会自动规范化：

```
1706.03762 / 1706.03762v7 / arXiv:1706.03762 / https://arxiv.org/abs/1706.03762  → arXiv:1706.03762
10.18653/v1/N19-1423 / doi:… / https://doi.org/…                                → DOI:10.18653/v1/N19-1423
Semantic Scholar 40 位 paperId、CorpusId:xxx、PMID:xxx 等                          → 原样传递
```

`search_arxiv` 的普通文本会去掉英文停用词后按 AND 匹配（`diffusion transformer` → `all:diffusion AND all:transformer`）；也可以直接写 arXiv 原生语法，如 `ti:"neural radiance" AND cat:cs.CV`、`au:hinton`。

### 返回格式

成功：

```json
{ "query": "...", "totalResults": 91, "returned": 3, "papers": [ { "id": "1706.03762v7", "baseId": "1706.03762", "title": "...", "authors": ["..."], "summary": "...", "published": "2017-06-12T17:57:34Z", "pdfUrl": "https://arxiv.org/pdf/1706.03762v7" } ] }
```

失败（`isError: true`）：

```json
{ "error": { "code": "RATE_LIMITED", "source": "Semantic Scholar", "status": 429, "message": "Semantic Scholar 触发限流（HTTP 429），请稍后重试。配置 SEMANTIC_SCHOLAR_API_KEY 可获得更高配额。" } }
```

`code` 取值：`RATE_LIMITED`、`NOT_FOUND`、`BAD_REQUEST`、`UPSTREAM_ERROR`、`NETWORK_ERROR`、`TIMEOUT`、`PARSE_ERROR`。429 和 5xx 会先自动重试（最多等待 5 秒），仍失败才返回错误。

## 环境变量

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `SEMANTIC_SCHOLAR_API_KEY` | 否 | Semantic Scholar API Key（[申请](https://www.semanticscholar.org/product/api#api-key)）。不配置也能用，但共享匿名配额很容易触发 429 |

## 构建与测试

```bash
pnpm --filter @paper-galaxy/scholar-mcp build
pnpm --filter @paper-galaxy/scholar-mcp smoke   # 需要联网，真实调用 arXiv / Semantic Scholar
```

冒烟测试会分别通过进程内（InMemoryTransport）和 stdio（启动 `dist/cli.js`）两种方式连接服务器。arXiv 搜不到结果视为失败；Semantic Scholar 在无 Key 时若返回友好的限流错误，只告警不失败。

## 接入方式

### 1. Next.js 中通过 Vercel AI SDK（stdio，推荐用于本地 / Node 运行时）

先在 `apps/web/package.json` 中加入 `"@paper-galaxy/scholar-mcp": "workspace:*"`。

```ts
import { createRequire } from "node:module";
// AI SDK 5 的导入路径；AI SDK 6 起改为 `import { experimental_createMCPClient } from "@ai-sdk/mcp"`
import { experimental_createMCPClient as createMCPClient } from "ai";
import { Experimental_StdioMCPTransport as StdioMCPTransport } from "ai/mcp-stdio";

const require = createRequire(import.meta.url);

const scholar = await createMCPClient({
  transport: new StdioMCPTransport({
    command: "node",
    args: [require.resolve("@paper-galaxy/scholar-mcp/cli")],
    env: { SEMANTIC_SCHOLAR_API_KEY: process.env.SEMANTIC_SCHOLAR_API_KEY ?? "" },
  }),
});

const result = streamText({
  model,
  tools: await scholar.tools(),
  onFinish: () => scholar.close(),
  // ...
});
```

> 路由需运行在 Node.js 运行时（`export const runtime = "nodejs"`），Edge 运行时无法启动子进程。

### 2. 进程内直连（无需子进程，适合 Vercel Serverless）

```ts
import { createScholarServer } from "@paper-galaxy/scholar-mcp";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";

const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
await createScholarServer().connect(serverTransport);

const client = new Client({ name: "paper-galaxy-web", version: "0.1.0" });
await client.connect(clientTransport);

const res = await client.callTool({ name: "get_references", arguments: { paper_id: "1706.03762", limit: 10 } });
```

AI SDK 的 `createMCPClient` 也接受任意实现了 MCP `Transport` 接口的对象，可直接传入上面的 `clientTransport`。

不需要 MCP 协议层时，也可以直接调用底层函数（返回 `{ ok, data } | { ok, error }`）：

```ts
import { searchArxiv, getPaper, getReferences, getCitations } from "@paper-galaxy/scholar-mcp";
```

### 3. Claude Desktop / Claude Code / 其他 MCP 宿主

```json
{
  "mcpServers": {
    "paper-galaxy-scholar": {
      "command": "node",
      "args": ["E:/传/2-web/paper-galaxy/packages/scholar-mcp/dist/cli.js"],
      "env": { "SEMANTIC_SCHOLAR_API_KEY": "" }
    }
  }
}
```

调试可使用 MCP Inspector：`npx @modelcontextprotocol/inspector node dist/cli.js`。

## 目录结构

```
src/
  http.ts             fetch 封装：超时、重试、429/404 等转为友好错误
  arxiv.ts            arXiv 查询构造与 Atom 解析
  semanticScholar.ts  论文 id 规范化、详情 / 参考文献 / 被引
  server.ts           createScholarServer()：注册 4 个 MCP 工具
  cli.ts              stdio 入口（bin: scholar-mcp）
  index.ts            包导出
scripts/smoke.mjs     冒烟测试
```
