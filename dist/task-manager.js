import { randomUUID } from "node:crypto";
/**
 * In-memory task store with lifecycle management.
 *
 * This is intentionally simple — no persistence across server restarts.
 * For a production setup you'd back this with SQLite or similar.
 */
export class TaskManager {
    tasks = new Map();
    maxConcurrent;
    constructor(maxConcurrent = 4) {
        this.maxConcurrent = maxConcurrent;
    }
    /** Create a new task in "queued" state. */
    create(opts) {
        const task = {
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
    get(id) {
        return this.tasks.get(id);
    }
    listAll() {
        return Array.from(this.tasks.values()).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }
    listByStatus(status) {
        return this.listAll().filter((t) => t.status === status);
    }
    /** Check if we have capacity to start another task. */
    canStartMore() {
        return this.listByStatus("running").length < this.maxConcurrent;
    }
    /** Transition a task to "running". */
    markRunning(id, pid) {
        const task = this.mustGet(id);
        task.status = "running";
        task.startedAt = new Date().toISOString();
        task.pid = pid;
    }
    /** Transition a task to "completed" with a result. */
    markCompleted(id, result) {
        const task = this.mustGet(id);
        task.status = "completed";
        task.completedAt = new Date().toISOString();
        task.result = result;
        task.pid = undefined;
    }
    /** Transition a task to "failed" with an error message. */
    markFailed(id, error) {
        const task = this.mustGet(id);
        task.status = "failed";
        task.completedAt = new Date().toISOString();
        task.error = error;
        task.pid = undefined;
    }
    /** Mark a task as cancelled. Does NOT kill the process — caller handles that. */
    markCancelled(id) {
        const task = this.mustGet(id);
        task.status = "cancelled";
        task.completedAt = new Date().toISOString();
        task.pid = undefined;
    }
    /** Get the next queued task, if any. */
    nextQueued() {
        return this.listByStatus("queued")[0];
    }
    mustGet(id) {
        const task = this.tasks.get(id);
        if (!task)
            throw new Error(`Task ${id} not found`);
        return task;
    }
}
