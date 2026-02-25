import { describe, it, expect, beforeEach, vi } from "vitest";
import { z } from "zod";
import {
  DispatchTaskSchema,
  GetStatusSchema,
  GetResultSchema,
  CancelTaskSchema,
  ListTasksSchema,
  getToolDefinitions,
  createToolHandler,
} from "../src/tools.js";
import { TaskManager } from "../src/task-manager.js";
import { PermissionEngine } from "../src/permissions.js";

// ── Schema validation ────────────────────────────────────────────────────────

describe("Zod schemas", () => {
  describe("DispatchTaskSchema", () => {
    it("accepts valid input with required fields", () => {
      const result = DispatchTaskSchema.parse({
        prompt: "Build a feature",
        projectDir: "/home/user/proj",
      });
      expect(result.prompt).toBe("Build a feature");
      expect(result.projectDir).toBe("/home/user/proj");
      expect(result.maxTurns).toBe(30); // default
    });

    it("accepts all optional fields", () => {
      const result = DispatchTaskSchema.parse({
        prompt: "Build",
        projectDir: "/proj",
        maxTurns: 50,
        allowedTools: ["Read", "Write"],
      });
      expect(result.maxTurns).toBe(50);
      expect(result.allowedTools).toEqual(["Read", "Write"]);
    });

    it("rejects missing prompt", () => {
      expect(() => DispatchTaskSchema.parse({ projectDir: "/proj" })).toThrow();
    });

    it("rejects missing projectDir", () => {
      expect(() => DispatchTaskSchema.parse({ prompt: "hi" })).toThrow();
    });

    it("rejects maxTurns < 1", () => {
      expect(() =>
        DispatchTaskSchema.parse({ prompt: "hi", projectDir: "/proj", maxTurns: 0 })
      ).toThrow();
    });

    it("rejects maxTurns > 100", () => {
      expect(() =>
        DispatchTaskSchema.parse({ prompt: "hi", projectDir: "/proj", maxTurns: 101 })
      ).toThrow();
    });

    it("rejects non-integer maxTurns", () => {
      expect(() =>
        DispatchTaskSchema.parse({ prompt: "hi", projectDir: "/proj", maxTurns: 5.5 })
      ).toThrow();
    });
  });

  describe("GetStatusSchema", () => {
    it("accepts valid UUID", () => {
      const result = GetStatusSchema.parse({ taskId: "550e8400-e29b-41d4-a716-446655440000" });
      expect(result.taskId).toBe("550e8400-e29b-41d4-a716-446655440000");
    });

    it("rejects non-UUID string", () => {
      expect(() => GetStatusSchema.parse({ taskId: "not-a-uuid" })).toThrow();
    });

    it("rejects missing taskId", () => {
      expect(() => GetStatusSchema.parse({})).toThrow();
    });
  });

  describe("GetResultSchema", () => {
    it("accepts taskId with default tailLines", () => {
      const result = GetResultSchema.parse({
        taskId: "550e8400-e29b-41d4-a716-446655440000",
      });
      expect(result.tailLines).toBe(100); // default
    });

    it("accepts custom tailLines", () => {
      const result = GetResultSchema.parse({
        taskId: "550e8400-e29b-41d4-a716-446655440000",
        tailLines: 50,
      });
      expect(result.tailLines).toBe(50);
    });

    it("rejects tailLines > 500", () => {
      expect(() =>
        GetResultSchema.parse({
          taskId: "550e8400-e29b-41d4-a716-446655440000",
          tailLines: 501,
        })
      ).toThrow();
    });

    it("rejects tailLines < 1", () => {
      expect(() =>
        GetResultSchema.parse({
          taskId: "550e8400-e29b-41d4-a716-446655440000",
          tailLines: 0,
        })
      ).toThrow();
    });
  });

  describe("CancelTaskSchema", () => {
    it("accepts valid UUID", () => {
      const result = CancelTaskSchema.parse({ taskId: "550e8400-e29b-41d4-a716-446655440000" });
      expect(result.taskId).toBe("550e8400-e29b-41d4-a716-446655440000");
    });

    it("rejects non-UUID", () => {
      expect(() => CancelTaskSchema.parse({ taskId: "abc" })).toThrow();
    });
  });

  describe("ListTasksSchema", () => {
    it("defaults status to 'all'", () => {
      const result = ListTasksSchema.parse({});
      expect(result.status).toBe("all");
    });

    it("accepts valid status values", () => {
      for (const s of ["queued", "running", "completed", "failed", "cancelled", "all"]) {
        expect(ListTasksSchema.parse({ status: s }).status).toBe(s);
      }
    });

    it("rejects invalid status", () => {
      expect(() => ListTasksSchema.parse({ status: "invalid" })).toThrow();
    });
  });
});

// ── getToolDefinitions ───────────────────────────────────────────────────────

describe("getToolDefinitions", () => {
  it("returns 6 tool definitions", () => {
    const defs = getToolDefinitions();
    expect(defs.length).toBe(6);
  });

  it("includes all expected tool names", () => {
    const defs = getToolDefinitions();
    const names = defs.map((d) => d.name);
    expect(names).toContain("dispatch_task");
    expect(names).toContain("get_status");
    expect(names).toContain("get_result");
    expect(names).toContain("cancel_task");
    expect(names).toContain("list_tasks");
    expect(names).toContain("get_policy");
  });

  it("each tool has name, description, and inputSchema", () => {
    const defs = getToolDefinitions();
    for (const def of defs) {
      expect(def.name).toBeTruthy();
      expect(def.description).toBeTruthy();
      expect(def.inputSchema).toBeDefined();
      expect(def.inputSchema.type).toBe("object");
    }
  });

  it("dispatch_task requires prompt and projectDir", () => {
    const defs = getToolDefinitions();
    const dt = defs.find((d) => d.name === "dispatch_task")!;
    expect(dt.inputSchema.required).toContain("prompt");
    expect(dt.inputSchema.required).toContain("projectDir");
  });
});

// ── createToolHandler ────────────────────────────────────────────────────────

describe("createToolHandler", () => {
  let tm: TaskManager;
  let engine: PermissionEngine;
  let mockRunner: { drainQueue: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn> };
  let handler: (name: string, args: Record<string, unknown>) => Promise<any>;

  beforeEach(() => {
    tm = new TaskManager(4);
    engine = new PermissionEngine({
      allowedPaths: ["/home/user/project"],
    });
    mockRunner = {
      drainQueue: vi.fn(),
      cancel: vi.fn().mockReturnValue(true),
    };
    handler = createToolHandler(tm, mockRunner as any, engine);
  });

  // ── dispatch_task ─────────────────────────────────────────────────────

  describe("dispatch_task", () => {
    it("creates a task and returns taskId", async () => {
      const result = await handler("dispatch_task", {
        prompt: "Build a feature",
        projectDir: "/home/user/project",
      });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.taskId).toBeTruthy();
      expect(parsed.status).toBe("queued");
      expect(parsed.maxTurns).toBe(30);
      expect(mockRunner.drainQueue).toHaveBeenCalled();
    });

    it("denies dispatch to path outside allowed directories", async () => {
      const result = await handler("dispatch_task", {
        prompt: "Build",
        projectDir: "/etc/evil",
      });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Denied");
    });

    it("passes maxTurns and allowedTools to created task", async () => {
      const result = await handler("dispatch_task", {
        prompt: "Build",
        projectDir: "/home/user/project",
        maxTurns: 15,
        allowedTools: ["Read"],
      });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.maxTurns).toBe(15);

      const task = tm.get(parsed.taskId)!;
      expect(task.allowedTools).toEqual(["Read"]);
    });
  });

  // ── get_status ────────────────────────────────────────────────────────

  describe("get_status", () => {
    it("returns task status for a valid taskId", async () => {
      const task = tm.create({ prompt: "test", projectDir: "/home/user/project" });
      const result = await handler("get_status", { taskId: task.id });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.taskId).toBe(task.id);
      expect(parsed.status).toBe("queued");
      expect(parsed.hasResult).toBe(false);
      expect(parsed.hasError).toBe(false);
    });

    it("returns error for unknown taskId", async () => {
      const result = await handler("get_status", {
        taskId: "550e8400-e29b-41d4-a716-446655440000",
      });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("not found");
    });

    it("truncates long prompts in status response", async () => {
      const longPrompt = "x".repeat(300);
      const task = tm.create({ prompt: longPrompt, projectDir: "/home/user/project" });
      const result = await handler("get_status", { taskId: task.id });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.prompt.length).toBeLessThanOrEqual(203); // 200 + "..."
      expect(parsed.prompt).toContain("...");
    });
  });

  // ── get_result ────────────────────────────────────────────────────────

  describe("get_result", () => {
    it("returns '(no output yet)' for queued task", async () => {
      const task = tm.create({ prompt: "test", projectDir: "/home/user/project" });
      const result = await handler("get_result", { taskId: task.id });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.output).toBe("(no output yet)");
    });

    it("returns result for completed task", async () => {
      const task = tm.create({ prompt: "test", projectDir: "/home/user/project" });
      tm.markRunning(task.id, 123);
      tm.markCompleted(task.id, "line1\nline2\nline3");

      const result = await handler("get_result", { taskId: task.id });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.output).toContain("line1");
      expect(parsed.totalLines).toBe(3);
    });

    it("returns error content for failed task", async () => {
      const task = tm.create({ prompt: "test", projectDir: "/home/user/project" });
      tm.markRunning(task.id, 123);
      tm.markFailed(task.id, "something broke");

      const result = await handler("get_result", { taskId: task.id });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.output).toContain("something broke");
    });

    it("respects tailLines parameter", async () => {
      const task = tm.create({ prompt: "test", projectDir: "/home/user/project" });
      tm.markRunning(task.id, 123);
      const lines = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`).join("\n");
      tm.markCompleted(task.id, lines);

      const result = await handler("get_result", { taskId: task.id, tailLines: 5 });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.returnedLines).toBe(5);
      expect(parsed.totalLines).toBe(50);
    });

    it("returns error for unknown taskId", async () => {
      const result = await handler("get_result", {
        taskId: "550e8400-e29b-41d4-a716-446655440000",
      });
      expect(result.isError).toBe(true);
    });
  });

  // ── cancel_task ───────────────────────────────────────────────────────

  describe("cancel_task", () => {
    it("cancels a queued task", async () => {
      const task = tm.create({ prompt: "test", projectDir: "/home/user/project" });
      const result = await handler("cancel_task", { taskId: task.id });
      expect(result.content[0].text).toContain("cancelled");
      expect(task.status).toBe("cancelled");
    });

    it("cancels a running task via runner.cancel", async () => {
      const task = tm.create({ prompt: "test", projectDir: "/home/user/project" });
      tm.markRunning(task.id, 999);

      const result = await handler("cancel_task", { taskId: task.id });
      expect(result.content[0].text).toContain("SIGTERM");
      expect(mockRunner.cancel).toHaveBeenCalledWith(task.id);
    });

    it("reports when cancel finds no process", async () => {
      const task = tm.create({ prompt: "test", projectDir: "/home/user/project" });
      tm.markRunning(task.id, 999);
      mockRunner.cancel.mockReturnValue(false);

      const result = await handler("cancel_task", { taskId: task.id });
      expect(result.content[0].text).toContain("process not found");
    });

    it("reports already-completed tasks cannot be cancelled", async () => {
      const task = tm.create({ prompt: "test", projectDir: "/home/user/project" });
      tm.markRunning(task.id, 123);
      tm.markCompleted(task.id, "done");

      const result = await handler("cancel_task", { taskId: task.id });
      expect(result.content[0].text).toContain("already completed");
    });

    it("returns error for unknown taskId", async () => {
      const result = await handler("cancel_task", {
        taskId: "550e8400-e29b-41d4-a716-446655440000",
      });
      expect(result.isError).toBe(true);
    });
  });

  // ── list_tasks ────────────────────────────────────────────────────────

  describe("list_tasks", () => {
    it("lists all tasks", async () => {
      tm.create({ prompt: "a", projectDir: "/home/user/project" });
      tm.create({ prompt: "b", projectDir: "/home/user/project" });

      const result = await handler("list_tasks", {});
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.count).toBe(2);
      expect(parsed.tasks.length).toBe(2);
    });

    it("filters by status", async () => {
      const t1 = tm.create({ prompt: "a", projectDir: "/home/user/project" });
      tm.create({ prompt: "b", projectDir: "/home/user/project" });
      tm.markRunning(t1.id, 123);

      const result = await handler("list_tasks", { status: "running" });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.count).toBe(1);
      expect(parsed.tasks[0].status).toBe("running");
    });

    it("returns empty list when no tasks match", async () => {
      const result = await handler("list_tasks", { status: "failed" });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.count).toBe(0);
    });

    it("truncates long prompts in list output", async () => {
      const longPrompt = "y".repeat(200);
      tm.create({ prompt: longPrompt, projectDir: "/home/user/project" });

      const result = await handler("list_tasks", {});
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.tasks[0].prompt.length).toBeLessThanOrEqual(83); // 80 + "..."
    });
  });

  // ── get_policy ────────────────────────────────────────────────────────

  describe("get_policy", () => {
    it("returns the permission policy", async () => {
      const result = await handler("get_policy", {});
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.allowedPaths).toEqual(["/home/user/project"]);
      expect(parsed.safeTools).toBeDefined();
    });
  });

  // ── unknown tool ──────────────────────────────────────────────────────

  describe("unknown tool", () => {
    it("returns error for unknown tool name", async () => {
      const result = await handler("nonexistent_tool", {});
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Unknown tool");
    });
  });
});
