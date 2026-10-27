<div align="center">

<h1>论文星图 · PaperGalaxy</h1>

<p><strong>用母语读懂论文。</strong><br/>保留原版排版的 AI 论文阅读器：双语对照、论证脉络、可溯源问答、图表讲解与学术调研 Agent。</p>

<p>
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-7c8cff?style=flat-square"></a>
  <img alt="Next.js 15" src="https://img.shields.io/badge/Next.js-15-000?style=flat-square&logo=nextdotjs">
  <img alt="React 19" src="https://img.shields.io/badge/React-19-149eca?style=flat-square&logo=react&logoColor=white">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-strict-3178c6?style=flat-square&logo=typescript&logoColor=white">
  <img alt="MCP" src="https://img.shields.io/badge/MCP-enabled-f0abfc?style=flat-square">
  <a href="CONTRIBUTING.md"><img alt="PRs welcome" src="https://img.shields.io/badge/PRs-welcome-86efac?style=flat-square"></a>
</p>

<p>
  <strong>中文</strong> · <a href="README.en.md">English</a>
</p>

<p>
  <a href="#-特性">特性</a> ·
  <a href="#-快速开始">快速开始</a> ·
  <a href="#-使用指南">使用指南</a> ·
  <a href="#-架构与原理">架构与原理</a> ·
  <a href="#-部署">部署</a> ·
  <a href="#-常见问题">常见问题</a>
</p>

<img src=".github/assets/home.jpg" alt="论文星图首页" width="100%"/>

</div>

<br/>

读英文论文，难的往往不只是语言。通用翻译会把 PDF 版式拆散，对话机器人的回答找不到出处，图表和公式依然看不懂，相关文献要在好几个网站之间来回查。

**论文星图**把大模型、检索增强（RAG）、智能体（Agent）、MCP 工具协议和多模态理解，整合进一个完整的阅读流程。译文排回原文所在的位置，AI 给出的每个结论都能点回原文核对。论文文件只在你的浏览器里处理，不会上传。

<br/>

## ✨ 特性

<table>
<tr>
<td width="50%" valign="top">

### 📄 保留排版的双语阅读
- 原文 / 对照 / 译文三种模式，译文按原段落位置排回 PDF 页面
- 图表、公式、表格保持原样，左右两页逐段对应、同步高亮
- 字号自适应，以鼠标为中心缩放（50%–250%），深色纸张
- 当前页优先翻译，6 路并发；全文术语表保证译名一致

</td>
<td width="50%"><img src=".github/assets/reader.jpg" alt="对照阅读"/></td>
</tr>
<tr>
<td width="50%"><img src=".github/assets/chat.jpg" alt="溯源问答"/></td>
<td width="50%" valign="top">

### 🧠 读懂，而不只是读完
- **论文脉络**：把论文拆成问题、动机、方法、创新、实验、结论、局限这条论证链，每个节点都绑定原文证据
- **溯源问答**：先做查询改写，再用关键词与向量混合检索，然后生成回答；每个论断都附可点击的引用，并提示依据强度
- **划词**：选中原文即可翻译或交给 AI 解释

</td>
</tr>
<tr>
<td width="50%" valign="top">

### 🔍 看懂图表，找到相关研究
- **框选讲解**：框选任意图、表或公式，视觉模型结合本页原文讲解
- **学者 Agent**：通过自研 MCP 服务器调用 arXiv 与 Semantic Scholar，自主调研前置工作、后续工作和相近研究；工具调用过程实时可见
- **论文库检索**：在所有论文中做语义检索，结果直达对应段落

</td>
<td width="50%"><img src=".github/assets/vision.jpg" alt="框选讲解"/></td>
</tr>
<tr>
<td width="50%"><img src=".github/assets/agent.jpg" alt="学者 Agent"/></td>
<td width="50%" valign="top">

### 🔒 本地优先，开箱即用
- PDF 解析、向量化、检索、存储全部在浏览器完成
- 模型在网页中配置，支持**任意 OpenAI 兼容接口**；Key 只保存在你的浏览器
- 问答与调研记录自动保存，记住阅读位置，可导出双语 Markdown 笔记
- 适配桌面与移动端

</td>
</tr>
</table>

<details>
<summary><b>更多截图</b></summary>

<br/>

| 论文脉络 | 译文模式与术语表 |
|---|---|
| <img src=".github/assets/outline.jpg" alt="论文脉络"/> | <img src=".github/assets/translation.jpg" alt="译文模式"/> |

| 论文库语义检索 | 移动端 |
|---|---|
| <img src=".github/assets/library.jpg" alt="论文库检索"/> | <img src=".github/assets/mobile-home.jpg" alt="移动端首页" width="48%"/> <img src=".github/assets/mobile-reader.jpg" alt="移动端阅读器" width="48%"/> |

</details>

<br/>

## 🚀 快速开始

### 1. 环境要求

- [Node.js](https://nodejs.org/) **18.18** 或更高版本（推荐 20 LTS 或 22 LTS）
- [Git](https://git-scm.com/)
- 一个 OpenAI 兼容接口的大模型 API Key（见[第 4 步](#4-在网页中配置模型)）

### 2. 获取代码并安装

```bash
git clone https://github.com/<your-username>/paper-galaxy.git
cd paper-galaxy
npm run setup
```

`npm run setup` 会安装 Web 应用和 MCP 服务器的依赖，并构建 MCP 服务器，首次运行约需 1–3 分钟。

### 3. 启动

```bash
npm run dev
```

在浏览器中打开 <http://localhost:3000>。

### 4. 在网页中配置模型

<img src=".github/assets/settings.jpg" alt="模型设置" width="420" align="right"/>

点击右上角的 **⚙ 齿轮图标**，打开“模型设置”：

| 字段 | 说明 |
|---|---|
| 接口地址 | 服务商的 OpenAI 兼容地址，通常以 `/v1` 结尾 |
| API Key | 在服务商控制台创建 |
| 主模型 | 用于问答、论文脉络，建议选综合能力强的模型 |
| 快速模型 | 用于翻译、检索改写、Agent；可选更快、更便宜的模型，留空则与主模型相同 |
| 视觉模型 | 用于框选讲解，需要支持图片输入；可留空 |
| 关闭思考模式 | 快速模型如果是“思考模型”，勾选后翻译明显更快 |

填写后点 **测试连接**，看到“连接成功”即可保存。

> 🔐 Key 只保存在当前浏览器（localStorage）。调用 AI 时，Key 随请求经本站服务端转发给模型服务，服务端不保存，也不写入日志。

<br clear="right"/>

<details>
<summary><b>常见服务的填写示例</b>（点击展开）</summary>

<br/>

模型名称请以服务商控制台为准，下表仅供参考。

| 服务 | 接口地址 | 主模型示例 | 视觉模型示例 |
|---|---|---|---|
| DeepSeek | `https://api.deepseek.com/v1` | `deepseek-chat` | — |
| 阿里云百炼 | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-plus` | `qwen-vl-plus` |
| 智谱 | `https://open.bigmodel.cn/api/paas/v4` | `glm-4.5-air` | `glm-4.5v` |
| OpenAI | `https://api.openai.com/v1` | `gpt-5-mini` | `gpt-5-mini` |
| Ollama（本地） | `http://localhost:11434/v1` | `qwen3:8b` | `qwen2.5vl:7b` |

使用 Ollama 等本地服务时，API Key 可以随便填一个非空值。

</details>

### 5. 开始阅读

把论文 PDF 拖到首页的上传卡片上；手边没有论文的话，点 **“试读示例：BERT”**。

<br/>

## 📖 使用指南

<table>
<tr><th width="22%">功能</th><th>怎么用</th></tr>
<tr><td>三种阅读模式</td><td>顶栏切换“原文 / 对照 / 译文”。悬停或点击任一段落，左右两侧同步高亮；再次点击、点空白处或按 <kbd>Esc</kbd> 取消选中。</td></tr>
<tr><td>缩放</td><td>顶栏 <kbd>−</kbd> / <kbd>+</kbd>，或按住 <kbd>Ctrl</kbd> 滚动滚轮，以鼠标位置为中心缩放；点百分比数字恢复适应宽度。</td></tr>
<tr><td>论文脉络与目录</td><td>点击顶栏左侧目录图标展开。点脉络节点会高亮对应的原文证据，也可以就该节点继续提问。</td></tr>
<tr><td>溯源问答</td><td>右侧“问答”标签，用中文或英文提问。回答中的 <code>P3</code> 标签是原文引用，悬停可预览，点击跳转。</td></tr>
<tr><td>框选讲解</td><td>点击顶栏“框选讲解”，在页面上拖出矩形，讲解显示在问答面板，可继续追问。按 <kbd>Esc</kbd> 退出框选。</td></tr>
<tr><td>划词</td><td>选中任意原文，在弹出的工具条中选择“翻译”或“解释”。</td></tr>
<tr><td>术语表</td><td>右侧“术语”标签，可搜索；点击术语，由 AI 结合论文解释。</td></tr>
<tr><td>相关研究</td><td>右侧“相关研究”标签，选“前置工作 / 后续工作 / 相近研究”，或输入自定义目标；报告可一键复制。</td></tr>
<tr><td>论文库检索</td><td>首页下方的论文库，用自然语言描述你记得的内容，结果直达对应段落。</td></tr>
<tr><td>导出笔记</td><td>顶栏下载图标，导出双语 Markdown：一句话概括、论证脉络、译文与原文对照、术语表。</td></tr>
</table>

<br/>

## 🏗 架构与原理

<div align="center"><img src=".github/assets/architecture.png" alt="系统架构" width="92%"/></div>

<br/>

论文星图采用**端云协同**架构：浏览器负责 PDF 解析、渲染、向量化、检索与存储；Next.js 服务端只作为 AI 接入层，负责组织 Prompt、调用模型与 MCP 工具，并以流的形式返回结果。

<details>
<summary><b>保留排版翻译</b></summary>

<br/>

1. pdf.js 取出文本项及坐标。先通过栏间空白判断单栏或双栏，再按基线聚合成行（上下标并入所在行）。
2. 依据行距、缩进与句末标点分段；识别标题、独立公式和图表标签，公式不进入正文。
3. 记录每个段落在页面上的矩形区域，跨栏或跨页时拆成多个。
4. 译文页先绘制原页面，再在段落区域排入译文。字号由二分查找求出“能放下全部译文的最大值”，并以 CSS 缩放变量写入，缩放时无需重新排版。

</details>

<details>
<summary><b>可溯源的混合检索问答（RAG）</b></summary>

<br/>

1. **查询改写**：把中文问题改写为英文检索语句与关键词，并用术语表把中文译名映射回英文原词。
2. **双通道检索**：MiniSearch BM25 与端侧向量（multilingual-e5-small，Web Worker 中运行）各取前 20 名。
3. **RRF 融合**：`score(d) = Σ 1 / (60 + rank_c(d))`，取前 6 段作为上下文。
4. **引用约束生成**：要求每个论断标注段落编号，服务端剔除编造的编号；首条结果被两路同时命中时，标记为“依据充分”。

</details>

<details>
<summary><b>学者 Agent 与 MCP</b></summary>

<br/>

[`packages/scholar-mcp`](packages/scholar-mcp) 是一个独立的 MCP 服务器，提供 `search_arxiv`、`get_paper`、`get_references`、`get_citations` 四个工具，也可以接入其他任何 MCP 客户端。

Web 端的 `/api/agent` 作为 MCP 客户端，通过 stdio 启动它，把工具交给模型自主规划，最多执行 8 步；每次调用都以 NDJSON 事件流实时推送到界面。遇到限流时，Agent 会自动换用其他数据源。

</details>

<details>
<summary><b>目录结构</b></summary>

<br/>

```
apps/web/
  app/                 页面（首页、/paper/[id]）与 API 路由
  components/          阅读器、问答、Agent、模型设置、WebGL 背景
  lib/ai/              模型接入、Prompt、安全策略（仅服务端）
  lib/pdf/             PDF 解析与导入
  lib/rag/             端侧向量化、混合检索
  lib/hooks/           AI 预处理流水线、翻译队列、解析版本升级
  stores/              Zustand 状态（阅读器、模型设置）
packages/scholar-mcp/  学术检索 MCP 服务器
```

</details>

**技术栈**：Next.js 15 · React 19 · TypeScript · Tailwind CSS 4 · Vercel AI SDK 5 · Model Context Protocol · Zod · Dexie（IndexedDB）· Zustand · pdf.js · Transformers.js · MiniSearch · WebGL2

<br/>

## 🔒 隐私与安全

- **论文不离开设备**：PDF 原件、解析结果、译文、向量都存在浏览器 IndexedDB 中；服务端只接收完成单次 AI 任务所需的文本片段。
- **Key 由你掌握**：网页中填写的 Key 只存在本机浏览器，服务端不保存；仓库中不包含任何密钥。
- **防 Prompt 注入**：论文内容一律视为数据，系统提示词明确忽略其中的指令；越权输入会被拦截。
- **输出可控**：结构化输出按 Schema 校验并自动重试；引用编号由服务端校验；原文找不到依据时会明确告知。

<br/>

## 🚢 部署

```bash
npm run build
npm run start          # 默认端口 3000，可置于 Nginx 等反向代理之后
```

- 学者 Agent 需要服务端能启动 Node 子进程（stdio MCP），推荐部署在云服务器或容器中。
- 端侧向量模型约 120 MB，可预先下载到 `apps/web/public/models`，随应用一起发布：

  ```bash
  HF_ENDPOINT=https://hf-mirror.com npm run download-model --prefix apps/web
  ```

<details>
<summary><b>可选：服务端默认模型</b>（用于部署公共实例）</summary>

<br/>

如果希望访问者不填写也能直接使用，可以配置服务端的默认模型。网页中填写的配置优先，两者不会混用。

```bash
cp apps/web/.env.example apps/web/.env.local   # 填写后重启
```

| 变量 | 说明 |
|---|---|
| `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` | 默认模型的接口地址、Key 与模型名 |
| `LLM_FAST_MODEL` | 快速模型，留空则与主模型相同 |
| `LLM_VISION_MODEL` | 视觉模型，留空则框选讲解不可用 |
| `LLM_EXTRA_BODY` / `LLM_FAST_EXTRA_BODY` | 附加到请求体的 JSON，例如 `{"enable_thinking":false}` |
| `SEMANTIC_SCHOLAR_API_KEY` | Semantic Scholar 密钥，减少 Agent 被限流 |
| `SCHOLAR_MCP_PATH` | scholar-mcp 入口，默认为 `packages/scholar-mcp/dist/cli.js` |
| `NEXT_PUBLIC_HF_ENDPOINT` | 端侧模型的下载源，例如 `https://hf-mirror.com` |

`.env.local` 已被 `.gitignore` 忽略，不会被提交。

</details>

<br/>

## ❓ 常见问题

<details>
<summary><b>右上角齿轮旁有一个黄点？</b></summary>
<br/>还没有配置模型。打开“模型设置”，填写并测试连接即可。
</details>

<details>
<summary><b>测试连接提示“请检查 API Key”或“模型不存在”？</b></summary>
<br/>确认接口地址以 <code>/v1</code> 等兼容路径结尾，Key 没有多余的空格，模型名与服务商控制台中的完全一致。
</details>

<details>
<summary><b>顶栏的语义索引一直在转圈？</b></summary>
<br/>首次使用需要下载约 120 MB 的端侧向量模型。网络较慢时可以设置 <code>NEXT_PUBLIC_HF_ENDPOINT=https://hf-mirror.com</code>，或参照“部署”一节预先下载模型。索引完成前，问答会自动使用关键词检索。
</details>

<details>
<summary><b>学者 Agent 提示 Semantic Scholar 限流？</b></summary>
<br/>公共接口有频率限制，Agent 会自动改用 arXiv 继续检索。如果需要更稳定的结果，可以免费申请密钥，并配置 <code>SEMANTIC_SCHOLAR_API_KEY</code>。
</details>

<details>
<summary><b>扫描版 PDF 可以用吗？</b></summary>
<br/>暂不支持。扫描版没有文字层，需要 OCR，已列入路线图。
</details>

<details>
<summary><b>升级后，以前导入的论文会怎样？</b></summary>
<br/>解析规则升级后再次打开旧论文，会用本地保存的 PDF 自动重新解析。文本没有变化的段落保留原有译文，无需重新上传。
</details>

<br/>

## 🗺 路线图

- [ ] 扫描版 PDF：OCR 与版面分析
- [ ] 行内公式识别为 LaTeX，在译文中原样排版
- [ ] 学习模式：根据论文生成理解检测题与复习卡片
- [ ] 问答评测集，量化检索召回率与回答忠实度
- [ ] 多人共享批注与论文库

## 🤝 参与贡献

欢迎提交 Issue 和 Pull Request，开发流程与规范见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 📄 许可证

[MIT](LICENSE)

## 🙏 致谢

- [pdf.js](https://mozilla.github.io/pdf.js/)、[Transformers.js](https://huggingface.co/docs/transformers.js)、[Vercel AI SDK](https://ai-sdk.dev/)、[Model Context Protocol](https://modelcontextprotocol.io/)、[MiniSearch](https://lucaong.github.io/minisearch/)
- 学术数据来自 [arXiv API](https://info.arxiv.org/help/api/) 与 [Semantic Scholar](https://www.semanticscholar.org/product/api)
- 示例论文：Devlin et al., *BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding*, NAACL 2019，来自 [ACL Anthology](https://aclanthology.org/N19-1423/)，采用 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) 许可

<div align="center"><sub>如果这个项目对你有帮助，欢迎点一个 ⭐</sub></div>
