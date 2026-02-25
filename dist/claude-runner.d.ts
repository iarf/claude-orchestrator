import { TaskManager, Task } from "./task-manager.js";
import { PermissionEngine, PermissionRequest, PolicyDecision } from "./permissions.js";
export interface RunnerConfig {
    /** Path to the `claude` CLI binary. Defaults to "claude". */
    claudeBin?: string;
    /** Model to use. Defaults to whatever Claude Code defaults to. */
    model?: string;
    /** Global max turns if not set per-task. */
    defaultMaxTurns?: number;
}
/**
 * Wraps the Claude Code CLI to execute tasks with safety constraints.
 *
 * Each task runs as a child process: `claude -p "<prompt>" --cwd <dir> ...`
 * Output is captured from stdout and streamed into the task result.
 */
export declare class ClaudeRunner {
    private taskManager;
    private permissions;
    private config;
    private processes;
    constructor(taskManager: TaskManager, permissions: PermissionEngine, config?: RunnerConfig);
    /**
     * Start executing a queued task. Non-blocking — returns immediately.
     * The task result is written back into the TaskManager when done.
     */
    execute(task: Task): void;
    /** Cancel a running task by killing the subprocess. */
    cancel(taskId: string): boolean;
    /** Check the queue and start tasks if we have capacity. */
    drainQueue(): void;
    /**
     * Handle a permission prompt from Claude Code's --permission-prompt-tool.
     * This is called when the agent requests approval for an action.
     */
    handlePermission(req: PermissionRequest): PolicyDecision;
    private buildArgs;
}
