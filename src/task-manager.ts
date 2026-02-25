import { randomUUID } from "node:crypto";

export type TaskStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface Task {
  id: string;
  prompt: string;
  projectDir: string;
  status: TaskStatus;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  result?: string;
  error?: string;
  turns: number;
  maxTurns: number;
  allowedTools?: string[];
  /** PID of the Claude Code subprocess, used for cancellation. */
  pid?: number;
}

export interface DispatchOptions {
  prompt: string;
  projectDir: string;
  maxTurns?: number;
  allowedTools?: string[];
}

/**
 * In-memory task store with lifecycle management.
 *
 * This is intentionally simple — no persistence across server restarts.
 * For a production setup you'd back this with SQLite or similar.
 */
export class TaskManager {
  private tasks = new Map<string, Task>();
  private maxConcurrent: number;

  constructor(maxConcurrent = 4) {
    this.maxConcurrent = maxConcurrent;
  }

  /** Create a new task in "queued" state. */
  create(opts: DispatchOptions): Task {
    const task: Task = {
      id: randomUUID(),
      prompt: opts.prompt,
      projectDir: opts.projectDir,
      status: "queued",
      createdAt: new Date().toISOString(),
      turns: 0,
      maxTurns: opts.maxTurns ?? 30,
      allowedTools: opts.allowedTools,
    };
    this.tasks.set(task.id, task);
    return task;
  }

  get(id: string): Task | undefined {
    return this.tasks.get(id);
  }

  listAll(): Task[] {
    return Array.from(this.tasks.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  listByStatus(status: TaskStatus): Task[] {
    return this.listAll().filter((t) => t.status === status);
  }

  /** Check if we have capacity to start another task. */
  canStartMore(): boolean {
    return this.listByStatus("running").length < this.maxConcurrent;
  }

  /** Transition a task to "running". */
  markRunning(id: string, pid: number): void {
    const task = this.mustGet(id);
    task.status = "running";
    task.startedAt = new Date().toISOString();
    task.pid = pid;
  }

  /** Transition a task to "completed" with a result. */
  markCompleted(id: string, result: string): void {
    const task = this.mustGet(id);
    task.status = "completed";
    task.completedAt = new Date().toISOString();
    task.result = result;
    task.pid = undefined;
  }

  /** Transition a task to "failed" with an error message. */
  markFailed(id: string, error: string): void {
    const task = this.mustGet(id);
    task.status = "failed";
    task.completedAt = new Date().toISOString();
    task.error = error;
    task.pid = undefined;
  }

  /** Mark a task as cancelled. Does NOT kill the process — caller handles that. */
  markCancelled(id: string): void {
    const task = this.mustGet(id);
    task.status = "cancelled";
    task.completedAt = new Date().toISOString();
    task.pid = undefined;
  }

  /** Get the next queued task, if any. */
  nextQueued(): Task | undefined {
    return this.listByStatus("queued")[0];
  }

  private mustGet(id: string): Task {
    const task = this.tasks.get(id);
    if (!task) throw new Error(`Task ${id} not found`);
    return task;
  }
}
