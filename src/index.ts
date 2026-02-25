#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { loadConfig } from "./config.js";
import { PermissionEngine } from "./permissions.js";
import { TaskManager } from "./task-manager.js";
import { ClaudeRunner } from "./claude-runner.js";
import { getToolDefinitions, createToolHandler } from "./tools.js";

async function main() {
  const config = loadConfig();

  if (config.allowedPaths.length === 0) {
    console.error(
      "ERROR: No allowed paths configured.\n" +
        "Set allowedPaths in orchestrator.config.json or ORCHESTRATOR_ALLOWED_PATHS env var.\n" +
        "Example: ORCHESTRATOR_ALLOWED_PATHS=/home/ian/projects/myapp:/home/ian/projects/api"
    );
    process.exit(1);
  }

  // Initialize components
  const permissions = new PermissionEngine({
    allowedPaths: config.allowedPaths,
    blockedTools: config.blockedTools,
    blockedCommands: config.blockedCommands,
  });

  const taskManager = new TaskManager(config.maxConcurrent);

  const runner = new ClaudeRunner(taskManager, permissions, {
    claudeBin: config.claudeBin,
    model: config.model,
    defaultMaxTurns: config.defaultMaxTurns,
  });

  const handleTool = createToolHandler(taskManager, runner, permissions);

  // Create MCP server
  const server = new Server(
    {
      name: "claude-code-orchestrator",
      version: "0.1.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Register tool listing
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: getToolDefinitions(),
  }));

  // Register tool execution
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      return await handleTool(name, args ?? {});
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text" as const, text: `Error: ${message}` }],
        isError: true,
      };
    }
  });

  // Connect via stdio
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Log startup info to stderr (stdout is reserved for MCP protocol)
  console.error(`claude-code-orchestrator started`);
  console.error(`  Allowed paths: ${config.allowedPaths.join(", ")}`);
  console.error(`  Max concurrent: ${config.maxConcurrent}`);
  console.error(`  Default max turns: ${config.defaultMaxTurns}`);
  console.error(`  Claude binary: ${config.claudeBin}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
