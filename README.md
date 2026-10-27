# 论文星图 PaperGalaxy

> AI 论文阅读器：双语对照翻译、论文脉络解读、可溯源问答。

## 核心功能

| 功能 | 说明 | AI 技术 |
|---|---|---|
| 论文脉络 | 把论文拆成“问题 → 动机 → 方法 → 创新 → 实验 → 结论 → 局限”的论证链，附章节目录；点击任一环节定位并高亮原文依据 | LLM 结构化输出 + 证据段落校验 |
| 原版 PDF 阅读 | 按页渲染原始排版（含图表、公式），文字可选中复制；夜间纸张模式 | — |
| 双语对照阅读 | 每页原版 PDF 旁边是该页的段落译文，点击或悬停任一侧，另一侧同步高亮；段落级流式翻译，按需翻译并本地缓存 | 术语表检索注入 Prompt，保证全文译名一致 |
| 术语表 | 自动抽取关键术语，原文中悬停显示译名与解释 | LLM 信息抽取 |
| 溯源问答 | 每个回答带 `P3` 等可点击引用；界面可视化“查询改写 → 混合检索 → 生成”过程 | 查询改写 + BM25/向量混合检索（RRF 融合）+ 引用约束生成 |
| 论文库检索 | 在所有论文中语义检索，结果直达原文段落 | 查询改写 + 端侧向量检索 |
| 划词翻译 / 解释 | 选中原文即可就地翻译（遵循术语表），或交给 AI 解释 | 流式翻译 + 问答 |
| 本地优先 | PDF 解析、向量化均在浏览器完成，数据存于 IndexedDB | Transformers.js 端侧 embedding（Web Worker） |

**AI 安全与可控**：Prompt 注入防护（论文内容只作数据）、输入拦截、结构化输出 schema 校验与自动重试、剔除模型编造的段落编号、依据强度提示、无依据时明确告知、所有 AI 失败都有界面兜底。

## 技术架构

```
浏览器                                           Next.js 服务端（仅作 AI 接入层）
├─ pdf.js 解析（双栏重排、标题识别、断词合并）      ├─ /api/glossary     术语抽取
├─ IndexedDB（Dexie）论文/段落/向量/译文缓存        ├─ /api/trajectory   研究轨迹拆解
├─ Web Worker + Transformers.js 端侧向量化          ├─ /api/translate    流式翻译
├─ MiniSearch BM25 + 向量检索 + RRF 融合            ├─ /api/query-plan   查询改写
└─ React 19 + Zustand + Tailwind 深色沉浸式界面       └─ /api/chat         带引用的流式问答
                                                     （Vercel AI SDK，OpenAI 兼容接口）
packages/scholar-mcp：学术检索 MCP 服务器（arXiv / Semantic Scholar）
```

技术栈：Next.js 15 · React 19 · TypeScript · Tailwind CSS 4 · Vercel AI SDK 5 · Zod · Dexie · Zustand · pdf.js · Transformers.js · MiniSearch

## 本地运行

需要 Node.js ≥ 18.18。

```bash
cd apps/web
npm install
cp .env.example .env.local   # 填入 LLM_API_KEY
npm run dev                  # http://localhost:3000
```

可选：把端侧 embedding 模型（约 120MB）下载到 `public/models`，随应用一起部署，避免用户访问 HuggingFace 过慢：

```bash
HF_ENDPOINT=https://hf-mirror.com npm run download-model
```

### 环境变量

| 变量 | 说明 |
|---|---|
| `LLM_API_KEY` | 大模型 API 密钥（必填） |
| `LLM_BASE_URL` | OpenAI 兼容接口地址，默认 DeepSeek |
| `LLM_MODEL` | 主模型，默认 `deepseek-chat` |
| `LLM_FAST_MODEL` | 翻译/改写用的快速模型，可选 |
| `LLM_EXTRA_BODY` / `LLM_FAST_EXTRA_BODY` | 附加到请求体的 JSON，可选。如百炼思考模型可设 `{"enable_thinking":false}` 降低翻译延迟 |
| `NEXT_PUBLIC_HF_ENDPOINT` | 端侧模型远程下载源，可选 |

## 目录结构

```
apps/web/
  app/                 页面与 API 路由
  components/          home / reader / chat 组件
  lib/ai/              模型接入、Prompt、安全策略
  lib/pdf/             PDF 解析
  lib/rag/             端侧向量化、混合检索
  lib/hooks/           AI 预处理流水线、翻译队列
  stores/              Zustand 状态
packages/scholar-mcp/  学术检索 MCP 服务器
```

