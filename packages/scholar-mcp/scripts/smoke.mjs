// Smoke test: run after `pnpm build`.
//   1. In-process: createScholarServer() + InMemoryTransport, call all four tools.
//   2. stdio: spawn dist/cli.js like a real MCP host and call search_arxiv.
// arXiv must return real papers (hard failure otherwise). Semantic Scholar is
// rate limited without an API key, so a friendly RATE_LIMITED error is accepted.
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createScholarServer } from "../dist/index.js";

let failed = false;
const fail = (msg) => {
  failed = true;
  console.error(`  ✗ ${msg}`);
};
const pass = (msg) => console.log(`  ✓ ${msg}`);

const parse = (res) => JSON.parse(res.content[0].text);

async function checkArxiv(client, label) {
  const res = await client.callTool({
    name: "search_arxiv",
    arguments: { query: "attention is all you need transformer", max_results: 3 },
  });
  const body = parse(res);
  if (res.isError || !body.papers?.length) {
    fail(`[${label}] search_arxiv returned no papers: ${JSON.stringify(body).slice(0, 300)}`);
    return null;
  }
  const first = body.papers[0];
  if (!first.id || !first.title || !first.pdfUrl || !first.authors.length) {
    fail(`[${label}] search_arxiv paper is missing fields: ${JSON.stringify(first)}`);
  }
  pass(`[${label}] search_arxiv → ${body.returned}/${body.totalResults}: "${first.title}" (${first.id}, ${first.published.slice(0, 10)})`);
  return first;
}

function checkS2(name, res, describe) {
  const body = parse(res);
  if (!res.isError) {
    pass(`${name} → ${describe(body)}`);
  } else if (["RATE_LIMITED", "TIMEOUT", "NETWORK_ERROR"].includes(body.error?.code)) {
    console.warn(`  ! ${name} → friendly error (${body.error.code}): ${body.error.message}`);
  } else {
    fail(`${name} → ${JSON.stringify(body.error)}`);
  }
}

console.log("1) in-memory transport");
{
  const server = createScholarServer();
  const client = new Client({ name: "smoke", version: "0.0.0" });
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverT), client.connect(clientT)]);

  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();
  const expected = ["get_citations", "get_paper", "get_references", "search_arxiv"];
  if (JSON.stringify(names) === JSON.stringify(expected)) pass(`tools: ${names.join(", ")}`);
  else fail(`unexpected tools: ${names.join(", ")}`);

  await checkArxiv(client, "memory");

  // "Attention Is All You Need" — a stable, heavily cited paper.
  const id = "1706.03762";
  checkS2(
    "get_paper",
    await client.callTool({ name: "get_paper", arguments: { id_or_doi: id } }),
    (p) => `"${p.title}" (${p.year}), citations=${p.citationCount}, tldr=${p.tldr ? "yes" : "no"}`,
  );
  checkS2(
    "get_references",
    await client.callTool({ name: "get_references", arguments: { paper_id: id, limit: 5 } }),
    (r) => `${r.returned} refs, e.g. "${r.papers[0]?.paper.title}"`,
  );
  checkS2(
    "get_citations",
    await client.callTool({ name: "get_citations", arguments: { paper_id: `arXiv:${id}`, limit: 5 } }),
    (r) => `${r.returned} citing papers, e.g. "${r.papers[0]?.paper.title}"`,
  );

  // Invalid input must surface as a tool error, not a crash.
  const bad = await client.callTool({ name: "search_arxiv", arguments: { query: "", max_results: 999 } }).catch((e) => e);
  if (bad instanceof Error || bad.isError) pass("invalid input rejected by zod schema");
  else fail("invalid input was accepted");

  await client.close();
}

console.log("2) stdio transport (dist/cli.js)");
{
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL("../dist/cli.js", import.meta.url))],
    stderr: "pipe",
  });
  const client = new Client({ name: "smoke-stdio", version: "0.0.0" });
  await client.connect(transport);
  await checkArxiv(client, "stdio");
  await client.close();
}

if (failed) {
  console.error("\nSMOKE TEST FAILED");
  process.exit(1);
}
console.log("\nSMOKE TEST PASSED");
