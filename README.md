# 论文星图 PaperGalaxy

> 用母语读懂论文。AI 论文阅读器：保留原版排版的双语对照、论证脉络、可溯源问答、图表讲解与学者 Agent。



## 项目概述

阅读英文论文时，读者常遇到四个问题：

- **读不懂**：通用翻译会拆散版式，术语前后不一致。
- **抓不住**：理不清论文的论证主线。
- **不敢信**：AI 回答脱离原文。
- **找不全**：看不懂图表，不了解前后文献。

论文星图把 LLM、RAG、Agent、MCP、多模态和端侧 AI 组合进一个完整的阅读流程，所有 AI 结果都能落回原文位置。

**目标用户**：本科生、研究生、科研人员、算法工程师和课程教师。

## 核心功能

| 功能 | 说明 | AI 技术 |
|---|---|---|
| 保留排版的双语阅读 | 原文 / 对照 / 译文三种模式。译文排进原段落位置，字号自适应；图表、公式、表格保持原样。悬停或点击任一侧，两侧同步高亮。以鼠标为中心缩放（50%–250%），深色纸张 | LLM 翻译 + 术语表注入 |
| 论文脉络 | 拆成“问题 → 动机 → 方法 → 创新 → 实验 → 结论 → 局限”的论证链，附章节目录。点击节点即定位并高亮原文证据 | 结构化输出 + 证据编号校验 |
| 术语表 | 自动抽取关键术语，统一全文译名；点击术语由 AI 结合论文解释 | LLM 信息抽取 |
| 溯源问答 | 每个论断都带可点击的 `P3` 引用。界面可视化“查询改写 → 混合检索 → 生成”三步，并提示依据强度。问答记录本地保存 | 查询改写 + BM25 / 向量混合检索（RRF 融合）+ 引用约束生成 |
| 框选讲解 | 在 PDF 上框选任意图、表或公式，由视觉模型结合本页原文讲解，可继续追问 | 多模态 VLM + 上下文增强 |
| 学者 Agent | 一键调研前置工作、后续工作或相近研究，也可自定义目标。时间线实时展示每次工具调用，最后输出带链接的研究脉络报告，可一键复制 | Agent 自主规划 + MCP（自研 scholar-mcp：arXiv / Semantic Scholar） |
| 论文库检索 | 在所有论文中做语义检索，结果直达原文段落 | 查询改写 + 端侧向量检索 |
| 划词翻译 / 解释 | 选中原文即可就地翻译（遵循术语表），或交给 AI 解释 | 流式翻译 + 问答 |
| 模型设置 | 在网页中配置任意 OpenAI 兼容接口、Key 与模型，内置百炼 / DeepSeek / 智谱 / OpenAI 预设，可测试连接 | — |
| 体验细节 | 一键试读示例论文；记住阅读位置；导出双语 Markdown 笔记；移动端适配 | — |
| 本地优先 | PDF 解析、向量化均在浏览器完成，数据存于 IndexedDB，论文文件不上传 | Transformers.js 端侧 embedding（Web Worker） |

**AI 安全与可控**：

- **防注入**：论文内容一律视为数据，并拦截越权指令输入，防止 Prompt 注入。
- **输出可控**：结构化输出按 Zod Schema 校验，失败自动重试；剔除模型编造的段落编号。
- **可解释**：提示依据强度；原文中找不到依据时明确告知；Agent 的工具调用全程可见。
- **兜底与密钥**：所有 AI 失败都有界面兜底，阅读不受影响。网页填写的 Key 只存在本机浏览器；服务端密钥只从环境变量读取，仓库中不含任何密钥。

## 技术架构


```
浏览器（主体）                                     Next.js 服务端（仅作 AI 接入层）
├─ pdf.js 渲染与解析（双栏重排、标题识别、段落坐标）   ├─ /api/translate    流式翻译（fast 模型）
├─ 保留排版译文页、框选、划词、锚点缩放                ├─ /api/glossary     术语抽取（结构化）
├─ IndexedDB（Dexie）论文 / 段落 / 向量 / 译文 / 记录 ├─ /api/trajectory   论证脉络（结构化 + 证据校验）
├─ Web Worker + Transformers.js 端侧向量化            ├─ /api/query-plan   查询改写
├─ MiniSearch BM25 + 向量检索 + RRF 融合              ├─ /api/chat         带引用的流式问答
├─ Zustand 阅读器状态、翻译队列（当前页优先，并发 6）  ├─ /api/vision       图表 / 公式讲解（VLM）
└─ WebGL2 首页背景：极光粒子星云 + 星图仪              ├─ /api/agent        Agent（NDJSON 事件流）
                                                     │    └─ MCP 客户端 ⇄ scholar-mcp（stdio）
                                                     └─ /api/check        测试模型连接
packages/scholar-mcp：自研学术检索 MCP 服务器，提供 search_arxiv / get_paper / get_references / get_citations
```

| 档位 | 默认模型 | 任务 |
|---|---|---|
| chat | DeepSeek V4.1 Flash | 论证脉络、术语抽取、溯源问答 |
| fast | DeepSeek V4.1 Flash（关闭思考） | 翻译、查询改写、Agent |
| vision | Qwen3-VL-Plus | 框选讲解 |
| 端侧 | multilingual-e5-small（q8） | 段落与问题向量化 |

所有模型都通过 OpenAI 兼容接口接入。在网页“模型设置”中或服务端环境变量里修改，即可切换到 DeepSeek、通义千问、智谱等服务。

**技术栈**：Next.js 15 · React 19 · TypeScript · Tailwind CSS 4 · Vercel AI SDK 5 · MCP SDK · Zod · Dexie · Zustand · pdf.js · Transformers.js · MiniSearch · WebGL2

## 快速开始

需要 Node.js ≥ 18.18。

```bash
git clone <仓库地址> paper-galaxy && cd paper-galaxy
npm run setup        # 安装依赖并构建 scholar-mcp
npm run dev          # 打开 http://localhost:3000
```

1. 点击右上角的齿轮图标，打开“模型设置”。选择服务商预设（阿里云百炼、DeepSeek、智谱、OpenAI，或任意 OpenAI 兼容接口），填写 API Key，再点“测试连接”。
2. 点击“试读示例：BERT”或上传自己的论文 PDF。示例论文来自 ACL Anthology，采用 CC BY 4.0 许可。

> 网页中填写的 Key **只保存在当前浏览器**（localStorage）。调用 AI 时，Key 随请求发给本站服务端，再转发给模型服务；服务端不保存也不打印。

生产部署：

```bash
npm run build
npm run start        # 默认端口 3000，可置于 Nginx 反向代理之后
```

学者 Agent 需要在服务端启动 Node 子进程（stdio MCP），推荐部署在云服务器或容器中。

可选：把端侧 embedding 模型（约 120MB）下载到 `public/models`，随应用一起部署，避免首次使用时从 HuggingFace 下载过慢：

```bash
HF_ENDPOINT=https://hf-mirror.com npm run download-model --prefix apps/web
```

### 服务端默认配置（可选）

如果要部署公共演示站，让访问者不填 Key 也能使用，可以配置服务端的默认模型：

```bash
cp apps/web/.env.example apps/web/.env.local   # 填写后重启
```

`.env.local` 已加入 `.gitignore`，不会被提交。网页中填写的配置优先，两者不会混用。

| 变量 | 说明 |
|---|---|
| `LLM_API_KEY` | 默认模型的 API 密钥 |
| `LLM_BASE_URL` | OpenAI 兼容接口地址，默认 DeepSeek |
| `LLM_MODEL` | 主模型，默认 `deepseek-chat` |
| `LLM_FAST_MODEL` | 翻译、改写、Agent 用的快速模型（可选） |
| `LLM_VISION_MODEL` | 框选讲解用的视觉模型，如 `qwen3-vl-plus`（可选） |
| `LLM_EXTRA_BODY` / `LLM_FAST_EXTRA_BODY` | 附加到请求体的 JSON（可选）。例如百炼的思考模型可设 `{"enable_thinking":false}`，降低翻译延迟 |
| `SCHOLAR_MCP_PATH` | scholar-mcp 服务器入口，默认 `packages/scholar-mcp/dist/cli.js`（可选） |
| `SEMANTIC_SCHOLAR_API_KEY` | Semantic Scholar 密钥，用于减少限流（可选） |
| `NEXT_PUBLIC_HF_ENDPOINT` | 端侧模型的远程下载源（可选） |

## 目录结构

```
apps/web/
  app/                 页面（首页、/paper/[id]）与 8 个 API 路由
  components/          home / reader / chat / scholar 组件，WebGL 背景
  lib/ai/              模型接入、全部 Prompt、安全策略
  lib/pdf/             PDF 解析、文档缓存、导入
  lib/rag/             端侧向量化、混合检索、论文库检索
  lib/hooks/           AI 预处理流水线、翻译队列
  stores/              Zustand 状态（阅读器、模型设置）
  public/samples/      示例论文
packages/scholar-mcp/  学术检索 MCP 服务器
```

## 创新点

**技术创新**

- 坐标感知的保留排版翻译：译文按原位置排回 PDF 页面，适配任意缩放比例。
- 可验证的 RAG：跨语言查询改写，术语反向映射，双通道 RRF 融合，服务端校验引用编号。
- 自研标准 MCP 服务器：Agent 事件流实时可视化。
- 多模态讲解：框选的图像与本页原文一起作为上下文。
- 端云协同：端侧完成解析、向量化和检索，云侧完成大模型推理。

**应用创新**

- 从“翻译工具”到“读懂工具”：先看脉络再读细节，所有 AI 结果都能回到原文。
- AI 嵌入阅读动作：框选即讲、划词即译、点击即定位。
- 从单篇到知识网络：学者 Agent 加跨论文检索。

