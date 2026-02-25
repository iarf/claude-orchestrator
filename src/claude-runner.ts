import { spawn, ChildProcess } from "node:child_process";
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
export class ClaudeRunner {
  private taskManager: TaskManager;
  private permissions: PermissionEngine;
  private config: Required<RunnerConfig>;
  private processes = new Map<string, ChildProcess>();

  constructor(
    taskManager: TaskManager,
    permissions: PermissionEngine,
    config?: RunnerConfig
  ) {
    this.taskManager = taskManager;
    this.permissions = permissions;
    this.config = {
      claudeBin: config?.claudeBin ?? "claude",
      model: config?.model ?? "",
      defaultMaxTurns: config?.defaultMaxTurns ?? 30,
    };
  }

  /**
   * Start executing a queued task. Non-blocking — returns immediately.
   * The task result is written back into the TaskManager when done.
   */
  execute(task: Task): void {
    const args = this.buildArgs(task);

    const child = spawn(this.config.claudeBin, args, {
      cwd: task.projectDir,
      env: { ...process.env },
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.processes.set(task.id, child);
    this.taskManager.markRunning(task.id, child.pid!);

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("close", (code) => {
      this.processes.delete(task.id);

      if (this.taskManager.get(task.id)?.status === "cancelled") {
        return; // already marked cancelled
      }

      if (code === 0) {
        this.taskManager.markCompleted(task.id, stdout.trim());
      } else {
        this.taskManager.markFailed(
          task.id,
          `Exit code ${code}.\nstderr: ${stderr.trim()}\nstdout (partial): ${stdout.slice(-2000)}`
        );
      }

      // Drain: start next queued task if capacity available
      this.drainQueue();
    });

    child.on("error", (err) => {
      this.processes.delete(task.id);
      this.taskManager.markFailed(task.id, `Spawn error: ${err.message}`);
      this.drainQueue();
    });
  }

  /** Cancel a running task by killing the subprocess. */
  cancel(taskId: string): boolean {
    const child = this.processes.get(taskId);
    if (!child) return false;

    this.taskManager.markCancelled(taskId);
    child.kill("SIGTERM");

    // Force kill after 5 seconds if it hasn't exited
    setTimeout(() => {
      if (!child.killed) {
        child.kill("SIGKILL");
      }
    }, 5000);

    this.processes.delete(taskId);
    return true;
  }

  /** Check the queue and start tasks if we have capacity. */
  drainQueue(): void {
    while (this.taskManager.canStartMore()) {
      const next = this.taskManager.nextQueued();
      if (!next) break;
      this.execute(next);
    }
  }

  /**
   * Handle a permission prompt from Claude Code's --permission-prompt-tool.
   * This is called when the agent requests approval for an action.
   */
  handlePermission(req: PermissionRequest): PolicyDecision {
    return this.permissions.evaluate(req);
  }

  private buildArgs(task: Task): string[] {
    const args: string[] = [
      "-p",
      task.prompt,
      "--cwd",
      task.projectDir,
      "--max-turns",
      String(task.maxTurns || this.config.defaultMaxTurns),
      "--output-format",
      "text",
    ];

    if (this.config.model) {
      args.push("--model", this.config.model);
    }

    // Use allowedTools to constrain what the agent can do
    if (task.allowedTools && task.allowedTools.length > 0) {
      args.push("--allowedTools", task.allowedTools.join(","));
    }

    // Instead of --dangerously-skip-permissions, we could use
    // --permission-prompt-tool to route through our engine.
    // For now, we use skip-permissions + our own pre-validation
    // in the prompt to keep the subprocess non-interactive.
    //
    // To use the permission tool approach instead, you'd run a
    // secondary MCP server that the Claude Code subprocess connects
    // to, and route decisions through this.handlePermission().
    // That's a more complex setup documented in the README.
    args.push("--dangerously-skip-permissions");

    return args;
  }
}
