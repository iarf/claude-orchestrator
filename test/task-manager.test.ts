import { describe, it, expect, beforeEach } from "vitest";
import { TaskManager } from "../src/task-manager.js";

describe("TaskManager", () => {
  let tm: TaskManager;

  beforeEach(() => {
    tm = new TaskManager(2); // concurrency limit of 2
  });

  // ── create ──────────────────────────────────────────────────────────────────

  describe("create", () => {
    it("creates a task in queued state with a UUID id", () => {
      const task = tm.create({ prompt: "hello", projectDir: "/tmp/proj" });
      expect(task.status).toBe("queued");
      expect(task.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      );
      expect(task.prompt).toBe("hello");
      expect(task.projectDir).toBe("/tmp/proj");
      expect(task.createdAt).toBeTruthy();
      expect(task.turns).toBe(0);
    });

    it("uses default maxTurns of 30 when not specified", () => {
      const task = tm.create({ prompt: "p", projectDir: "/tmp" });
      expect(task.maxTurns).toBe(30);
    });

    it("uses provided maxTurns", () => {
      const task = tm.create({ prompt: "p", projectDir: "/tmp", maxTurns: 10 });
      expect(task.maxTurns).toBe(10);
    });

    it("stores allowedTools when provided", () => {
      const task = tm.create({
        prompt: "p",
        projectDir: "/tmp",
        allowedTools: ["Read", "Write"],
      });
      expect(task.allowedTools).toEqual(["Read", "Write"]);
    });

    it("leaves allowedTools undefined when not provided", () => {
      const task = tm.create({ prompt: "p", projectDir: "/tmp" });
      expect(task.allowedTools).toBeUndefined();
    });
  });

  // ── get ─────────────────────────────────────────────────────────────────────

  describe("get", () => {
    it("returns the task by id", () => {
      const task = tm.create({ prompt: "p", projectDir: "/tmp" });
      expect(tm.get(task.id)).toBe(task);
    });

    it("returns undefined for unknown id", () => {
      expect(tm.get("nonexistent")).toBeUndefined();
    });
  });

  // ── listAll / listByStatus ──────────────────────────────────────────────────

  describe("listing", () => {
    it("listAll returns all tasks", () => {
      const t1 = tm.create({ prompt: "first", projectDir: "/tmp" });
      const t2 = tm.create({ prompt: "second", projectDir: "/tmp" });
      const all = tm.listAll();
      expect(all.length).toBe(2);
      const ids = all.map((t) => t.id);
      expect(ids).toContain(t1.id);
      expect(ids).toContain(t2.id);
    });

    it("listAll sorts by createdAt descending when timestamps differ", () => {
      const t1 = tm.create({ prompt: "first", projectDir: "/tmp" });
      // Force t2 to have a later timestamp
      const t2 = tm.create({ prompt: "second", projectDir: "/tmp" });
      (t2 as any).createdAt = new Date(Date.now() + 1000).toISOString();
      const all = tm.listAll();
      expect(all[0].id).toBe(t2.id);
      expect(all[1].id).toBe(t1.id);
    });

    it("listByStatus filters correctly", () => {
      const t1 = tm.create({ prompt: "a", projectDir: "/tmp" });
      tm.create({ prompt: "b", projectDir: "/tmp" });
      tm.markRunning(t1.id, 1234);

      expect(tm.listByStatus("running").length).toBe(1);
      expect(tm.listByStatus("queued").length).toBe(1);
      expect(tm.listByStatus("completed").length).toBe(0);
    });
  });

  // ── canStartMore / concurrency ─────────────────────────────────────────────

  describe("canStartMore", () => {
    it("returns true when no tasks are running", () => {
      expect(tm.canStartMore()).toBe(true);
    });

    it("returns true when running count is below limit", () => {
      const t = tm.create({ prompt: "a", projectDir: "/tmp" });
      tm.markRunning(t.id, 100);
      expect(tm.canStartMore()).toBe(true); // limit is 2, only 1 running
    });

    it("returns false when running count equals limit", () => {
      const t1 = tm.create({ prompt: "a", projectDir: "/tmp" });
      const t2 = tm.create({ prompt: "b", projectDir: "/tmp" });
      tm.markRunning(t1.id, 100);
      tm.markRunning(t2.id, 101);
      expect(tm.canStartMore()).toBe(false);
    });

    it("returns true after a running task completes", () => {
      const t1 = tm.create({ prompt: "a", projectDir: "/tmp" });
      const t2 = tm.create({ prompt: "b", projectDir: "/tmp" });
      tm.markRunning(t1.id, 100);
      tm.markRunning(t2.id, 101);
      expect(tm.canStartMore()).toBe(false);

      tm.markCompleted(t1.id, "done");
      expect(tm.canStartMore()).toBe(true);
    });
  });

  // ── status transitions ─────────────────────────────────────────────────────

  describe("markRunning", () => {
    it("sets status, startedAt, and pid", () => {
      const t = tm.create({ prompt: "a", projectDir: "/tmp" });
      tm.markRunning(t.id, 9999);
      expect(t.status).toBe("running");
      expect(t.startedAt).toBeTruthy();
      expect(t.pid).toBe(9999);
    });

    it("throws for unknown id", () => {
      expect(() => tm.markRunning("bad-id", 1)).toThrow("not found");
    });
  });

  describe("markCompleted", () => {
    it("sets status, completedAt, result, and clears pid", () => {
      const t = tm.create({ prompt: "a", projectDir: "/tmp" });
      tm.markRunning(t.id, 10);
      tm.markCompleted(t.id, "all good");
      expect(t.status).toBe("completed");
      expect(t.completedAt).toBeTruthy();
      expect(t.result).toBe("all good");
      expect(t.pid).toBeUndefined();
    });

    it("throws for unknown id", () => {
      expect(() => tm.markCompleted("bad-id", "x")).toThrow("not found");
    });
  });

  describe("markFailed", () => {
    it("sets status, completedAt, error, and clears pid", () => {
      const t = tm.create({ prompt: "a", projectDir: "/tmp" });
      tm.markRunning(t.id, 10);
      tm.markFailed(t.id, "oops");
      expect(t.status).toBe("failed");
      expect(t.completedAt).toBeTruthy();
      expect(t.error).toBe("oops");
      expect(t.pid).toBeUndefined();
    });
  });

  describe("markCancelled", () => {
    it("sets status, completedAt, and clears pid", () => {
      const t = tm.create({ prompt: "a", projectDir: "/tmp" });
      tm.markRunning(t.id, 10);
      tm.markCancelled(t.id);
      expect(t.status).toBe("cancelled");
      expect(t.completedAt).toBeTruthy();
      expect(t.pid).toBeUndefined();
    });
  });

  // ── nextQueued ──────────────────────────────────────────────────────────────

  describe("nextQueued", () => {
    it("returns a queued task when one exists", () => {
      tm.create({ prompt: "first", projectDir: "/tmp" });
      tm.create({ prompt: "second", projectDir: "/tmp" });
      const next = tm.nextQueued();
      expect(next).toBeDefined();
      expect(next!.status).toBe("queued");
    });

    it("skips running tasks and returns a queued one", () => {
      const t1 = tm.create({ prompt: "first", projectDir: "/tmp" });
      const t2 = tm.create({ prompt: "second", projectDir: "/tmp" });
      tm.markRunning(t1.id, 100);

      const next = tm.nextQueued();
      expect(next).toBeDefined();
      expect(next!.id).toBe(t2.id);
    });

    it("returns undefined when no queued tasks", () => {
      const t = tm.create({ prompt: "a", projectDir: "/tmp" });
      tm.markRunning(t.id, 1);
      expect(tm.nextQueued()).toBeUndefined();
    });
  });

  // ── constructor defaults ───────────────────────────────────────────────────

  describe("constructor", () => {
    it("defaults maxConcurrent to 4", () => {
      const tmDefault = new TaskManager();
      // Create 4 tasks, mark all running
      const ids = Array.from({ length: 4 }, (_, i) =>
        tmDefault.create({ prompt: `t${i}`, projectDir: "/tmp" })
      );
      ids.forEach((t, i) => tmDefault.markRunning(t.id, i));
      expect(tmDefault.canStartMore()).toBe(false);
    });
  });
});
