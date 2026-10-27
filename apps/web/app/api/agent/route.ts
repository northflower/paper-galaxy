import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { jsonSchema, stepCountIs, streamText, tool, type ToolSet } from "ai";
import { z } from "zod";
import { errorResponse, getModel, readLlmConfig } from "@/lib/ai/provider";
import { AGENT_SYSTEM } from "@/lib/ai/prompts";
import { checkUserInput, clip } from "@/lib/ai/safety";

export const runtime = "nodejs";
export const maxDuration = 120;

// scholar-mcp 服务器入口；部署时可用环境变量指向其他位置
const SERVER_PATH = process.env.SCHOLAR_MCP_PATH ?? path.resolve(process.cwd(), "../../packages/scholar-mcp/dist/cli.js");

const GOALS = {
  background: "找出这篇论文最重要的前置工作（它建立在哪些研究之上）",
  followup: "找出引用这篇论文的重要后续工作（它启发了哪些研究）",
  related: "找出与这篇论文主题相近、方法可对比的论文",
} as const;

const bodySchema = z.object({
  title: z.string().min(1).max(300),
  summary: z.string().max(600).default(""),
  goal: z.enum(["background", "followup", "related", "custom"]),
  custom: z.string().max(300).default(""),
});

/**
 * 学者 Agent：作为 MCP 客户端，通过 stdio 启动 scholar-mcp 服务器，
 * 把服务器暴露的检索工具交给模型自主规划调用；执行过程以 NDJSON 事件流实时推送给前端时间线。
 */
export async function POST(req: Request) {
  const llm = readLlmConfig(req);
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) return Response.json({ error: "参数错误" }, { status: 400 });
  const { title, summary, goal, custom } = parsed.data;
  if (goal === "custom") {
    const blocked = checkUserInput(custom, 300);
    if (blocked) return Response.json({ error: blocked }, { status: 400 });
  }

  let client: Client;
  let tools: ToolSet;
  try {
    client = new Client({ name: "paper-galaxy", version: "0.1.0" });
    // 子进程默认只继承少量系统变量，Semantic Scholar 密钥需显式传入
    const env = { ...getDefaultEnvironment(), ...(process.env.SEMANTIC_SCHOLAR_API_KEY && { SEMANTIC_SCHOLAR_API_KEY: process.env.SEMANTIC_SCHOLAR_API_KEY }) };
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [SERVER_PATH], env, stderr: "ignore" }));
    const listed = await client.listTools();
    // MCP 工具 → AI SDK 工具：描述与 JSON Schema 原样转交，执行时回调 MCP 服务器
    tools = Object.fromEntries(
      listed.tools.map((t) => [
        t.name,
        tool({
          description: `${t.title ?? t.name}：${t.description ?? ""}`,
          inputSchema: jsonSchema(t.inputSchema as Parameters<typeof jsonSchema>[0]),
          execute: async (args) => {
            const res = await client.callTool({ name: t.name, arguments: args as Record<string, unknown> });
            const content = (res.content ?? []) as { type: string; text?: string }[];
            return clip(content.map((c) => c.text ?? "").join("\n"), 7000);
          },
        }),
      ]),
    );
  } catch (err) {
    console.error("[agent] MCP 服务器连接失败", err);
    return Response.json({ error: "学术检索服务（MCP）启动失败，请稍后重试" }, { status: 502 });
  }

  const task = goal === "custom" ? custom : GOALS[goal];
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: Record<string, unknown>) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      try {
        send({ type: "tools", names: Object.keys(tools) });
        // 快速模型：思考模式下的工具调用需要回传推理内容，兼容性较差
        const result = streamText({
          model: getModel("fast", llm),
          system: AGENT_SYSTEM,
          prompt: `正在阅读的论文：${title}\n${summary ? `概要：${summary}\n` : ""}调研目标：${task}`,
          tools,
          stopWhen: stepCountIs(8),
          temperature: 0.2,
        });
        let wroteText = false;
        for await (const part of result.fullStream) {
          // 不同步骤的文字各自成段，避免前一步的说明和报告标题粘在一起
          if (part.type === "text-start" && wroteText) send({ type: "text", delta: "\n\n" });
          else if (part.type === "tool-call") send({ type: "call", id: part.toolCallId, name: part.toolName, input: part.input });
          else if (part.type === "tool-result") send({ type: "result", id: part.toolCallId, summary: summarize(part.output) });
          else if (part.type === "tool-error") send({ type: "result", id: part.toolCallId, error: String(part.error) });
          else if (part.type === "text-delta") {
            wroteText = true;
            send({ type: "text", delta: part.text });
          }
          else if (part.type === "error") send({ type: "fatal", message: "AI 服务暂时不可用，请稍后重试" });
        }
        send({ type: "done" });
      } catch (err) {
        console.error("[agent]", err);
        send({ type: "fatal", message: err instanceof Error && err.message.includes("LLM_API_KEY") ? err.message : "Agent 执行失败，请稍后重试" });
      } finally {
        await client.close().catch(() => {});
        controller.close();
      }
    },
  });

  try {
    return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}

/** 工具结果摘要：解析 scholar-mcp 的 JSON 结果，给时间线一行可读说明 */
function summarize(output: unknown): string {
  const text = typeof output === "string" ? output : JSON.stringify(output);
  try {
    const data = JSON.parse(text);
    if (data.error) return `失败：${data.error.message ?? "未知错误"}`;
    if (Array.isArray(data.papers)) {
      const first = data.papers[0]?.title;
      return `返回 ${data.papers.length} 篇${first ? `，如《${clip(first, 60)}》` : ""}`;
    }
    if (data.title) return `《${clip(data.title, 70)}》${data.year ? `（${data.year}）` : ""}`;
  } catch {
    // 结果过长被截断时不是合法 JSON：按出现的标题数粗略统计
    const titles = text.match(/"title":\s*"([^"]+)"/g);
    if (titles?.length) {
      const first = titles[0].replace(/^"title":\s*"/, "").replace(/"$/, "");
      return `返回约 ${titles.length} 篇，如《${clip(first, 60)}》`;
    }
  }
  return clip(text.replace(/\s+/g, " "), 90);
}
