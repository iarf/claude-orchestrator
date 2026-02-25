export type TaskStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
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
export declare class TaskManager {
    private tasks;
    private maxConcurrent;
    constructor(maxConcurrent?: number);
    /** Create a new task in "queued" state. */
    create(opts: DispatchOptions): Task;
    get(id: string): Task | undefined;
    listAll(): Task[];
    listByStatus(status: TaskStatus): Task[];
    /** Check if we have capacity to start another task. */
    canStartMore(): boolean;
    /** Transition a task to "running". */
    markRunning(id: string, pid: number): void;
    /** Transition a task to "completed" with a result. */
    markCompleted(id: string, result: string): void;
    /** Transition a task to "failed" with an error message. */
    markFailed(id: string, error: string): void;
    /** Mark a task as cancelled. Does NOT kill the process — caller handles that. */
    markCancelled(id: string): void;
    /** Get the next queued task, if any. */
    nextQueued(): Task | undefined;
    private mustGet;
}
