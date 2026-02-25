import { z } from "zod";
import path from "node:path";
// ─── Schemas ────────────────────────────────────────────────────────────────
export const DispatchTaskSchema = z.object({
    prompt: z
        .string()
        .describe("The task prompt for the Claude Code agent. Be specific about what you want built/changed."),
    projectDir: z
        .string()
        .describe("Absolute path to the project directory the agent should work in. Must be within allowed paths."),
    maxTurns: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .default(30)
        .describe("Maximum agent turns before forced stop. Default 30."),
    allowedTools: z
        .array(z.string())
        .optional()
        .describe("Explicit tool whitelist for this agent. Omit to use defaults (Read, Edit, Write, Bash, Glob, Grep)."),
});
export const GetStatusSchema = z.object({
    taskId: z.string().uuid().describe("The task ID returned by dispatch_task."),
});
export const GetResultSchema = z.object({
    taskId: z.string().uuid().describe("The task ID returned by dispatch_task."),
    tailLines: z
        .number()
        .int()
        .min(1)
        .max(500)
        .optional()
        .default(100)
        .describe("Number of lines from the end of output to return. Default 100."),
});
export const CancelTaskSchema = z.object({
    taskId: z.string().uuid().describe("The task ID to cancel."),
});
export const ListTasksSchema = z.object({
    status: z
        .enum(["queued", "running", "completed", "failed", "cancelled", "all"])
        .optional()
        .default("all")
        .describe("Filter tasks by status. Default 'all'."),
});
// ─── Tool Definitions ───────────────────────────────────────────────────────
export function getToolDefinitions() {
    return [
        {
            name: "dispatch_task",
            description: "Dispatch a task to a Claude Code agent. Returns immediately with a task ID. " +
                "The agent runs asynchronously — use get_status and get_result to monitor progress. " +
                "The agent is scoped to the specified project directory and cannot operate outside allowed paths.",
            inputSchema: {
                type: "object",
                properties: {
                    prompt: { type: "string", description: DispatchTaskSchema.shape.prompt.description },
                    projectDir: { type: "string", description: DispatchTaskSchema.shape.projectDir.description },
                    maxTurns: { type: "number", description: "Maximum agent turns before forced stop. Default 30." },
                    allowedTools: {
                        type: "array",
                        items: { type: "string" },
                        description: "Explicit tool whitelist for this agent. Omit to use defaults.",
                    },
                },
                required: ["prompt", "projectDir"],
            },
        },
        {
            name: "get_status",
            description: "Get the current status of a dispatched task. Returns status, timing info, and turn count.",
            inputSchema: {
                type: "object",
                properties: {
                    taskId: { type: "string", description: "The task ID returned by dispatch_task." },
                },
                required: ["taskId"],
            },
        },
        {
            name: "get_result",
            description: "Get the output of a completed (or failed) task. Returns the agent's stdout. " +
                "For running tasks, returns partial output if available.",
            inputSchema: {
                type: "object",
                properties: {
                    taskId: { type: "string", description: "The task ID returned by dispatch_task." },
                    tailLines: { type: "number", description: "Lines from end of output to return. Default 100." },
                },
                required: ["taskId"],
            },
        },
        {
            name: "cancel_task",
            description: "Cancel a running or queued task. Sends SIGTERM to the agent process.",
            inputSchema: {
                type: "object",
                properties: {
                    taskId: { type: "string", description: "The task ID to cancel." },
                },
                required: ["taskId"],
            },
        },
        {
            name: "list_tasks",
            description: "List all tasks with optional status filter. Returns summary info for each task.",
            inputSchema: {
                type: "object",
                properties: {
                    status: {
                        type: "string",
                        enum: ["queued", "running", "completed", "failed", "cancelled", "all"],
                        description: "Filter by status. Default 'all'.",
                    },
                },
                required: [],
            },
        },
        {
            name: "get_policy",
            description: "Returns the current permission policy: allowed paths, blocked tools, and blocked command patterns. " +
                "Useful for understanding what the agent can and cannot do before dispatching.",
            inputSchema: {
                type: "object",
                properties: {},
                required: [],
            },
        },
    ];
}
// ─── Tool Handler ───────────────────────────────────────────────────────────
export function createToolHandler(taskManager, runner, permissions) {
    return async (name, args) => {
        switch (name) {
            case "dispatch_task": {
                const parsed = DispatchTaskSchema.parse(args);
                // Validate project directory is within allowed paths
                const pathCheck = permissions.evaluate({
                    tool: "Write",
                    filePath: parsed.projectDir,
                });
                if (pathCheck.action === "deny") {
                    return {
                        content: [
                            {
                                type: "text",
                                text: `Denied: ${pathCheck.reason}`,
                            },
                        ],
                        isError: true,
                    };
                }
                const task = taskManager.create({
                    prompt: parsed.prompt,
                    projectDir: path.resolve(parsed.projectDir),
                    maxTurns: parsed.maxTurns,
                    allowedTools: parsed.allowedTools,
                });
                // Attempt to start immediately if capacity available
                runner.drainQueue();
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify({
                                taskId: task.id,
                                status: task.status,
                                projectDir: task.projectDir,
                                maxTurns: task.maxTurns,
                                message: task.status === "running"
                                    ? "Task started. Use get_status to monitor progress."
                                    : "Task queued. Will start when capacity is available.",
                            }, null, 2),
                        },
                    ],
                };
            }
            case "get_status": {
                const { taskId } = GetStatusSchema.parse(args);
                const task = taskManager.get(taskId);
                if (!task) {
                    return {
                        content: [{ type: "text", text: `Task ${taskId} not found.` }],
                        isError: true,
                    };
                }
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify({
                                taskId: task.id,
                                status: task.status,
                                projectDir: task.projectDir,
                                createdAt: task.createdAt,
                                startedAt: task.startedAt,
                                completedAt: task.completedAt,
                                prompt: task.prompt.slice(0, 200) + (task.prompt.length > 200 ? "..." : ""),
                                hasResult: !!task.result,
                                hasError: !!task.error,
                            }, null, 2),
                        },
                    ],
                };
            }
            case "get_result": {
                const { taskId, tailLines } = GetResultSchema.parse(args);
                const task = taskManager.get(taskId);
                if (!task) {
                    return {
                        content: [{ type: "text", text: `Task ${taskId} not found.` }],
                        isError: true,
                    };
                }
                const output = task.result || task.error || "(no output yet)";
                const lines = output.split("\n");
                const tail = lines.slice(-tailLines).join("\n");
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify({
                                taskId: task.id,
                                status: task.status,
                                totalLines: lines.length,
                                returnedLines: Math.min(tailLines, lines.length),
                                output: tail,
                            }, null, 2),
                        },
                    ],
                };
            }
            case "cancel_task": {
                const { taskId } = CancelTaskSchema.parse(args);
                const task = taskManager.get(taskId);
                if (!task) {
                    return {
                        content: [{ type: "text", text: `Task ${taskId} not found.` }],
                        isError: true,
                    };
                }
                if (task.status === "queued") {
                    taskManager.markCancelled(taskId);
                    return {
                        content: [{ type: "text", text: `Task ${taskId} cancelled (was queued).` }],
                    };
                }
                if (task.status === "running") {
                    const killed = runner.cancel(taskId);
                    return {
                        content: [
                            {
                                type: "text",
                                text: killed
                                    ? `Task ${taskId} cancelled. SIGTERM sent to PID ${task.pid}.`
                                    : `Task ${taskId} marked cancelled but process not found (may have already exited).`,
                            },
                        ],
                    };
                }
                return {
                    content: [
                        {
                            type: "text",
                            text: `Task ${taskId} is already ${task.status}, cannot cancel.`,
                        },
                    ],
                };
            }
            case "list_tasks": {
                const { status } = ListTasksSchema.parse(args);
                const tasks = status === "all"
                    ? taskManager.listAll()
                    : taskManager.listByStatus(status);
                const summary = tasks.map((t) => ({
                    taskId: t.id,
                    status: t.status,
                    projectDir: t.projectDir,
                    prompt: t.prompt.slice(0, 80) + (t.prompt.length > 80 ? "..." : ""),
                    createdAt: t.createdAt,
                    completedAt: t.completedAt,
                }));
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify({ count: summary.length, tasks: summary }, null, 2),
                        },
                    ],
                };
            }
            case "get_policy": {
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify(permissions.describePolicy(), null, 2),
                        },
                    ],
                };
            }
            default:
                return {
                    content: [{ type: "text", text: `Unknown tool: ${name}` }],
                    isError: true,
                };
        }
    };
}
