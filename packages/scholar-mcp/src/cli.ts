#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createScholarServer, SERVER_NAME } from "./server.js";

async function main() {
  const server = createScholarServer();
  await server.connect(new StdioServerTransport());
  // stdout carries the MCP protocol, so diagnostics go to stderr.
  console.error(`[${SERVER_NAME}] running on stdio`);

  const shutdown = async () => {
    await server.close().catch(() => {});
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error(`[${SERVER_NAME}] failed to start:`, err);
  process.exit(1);
});
