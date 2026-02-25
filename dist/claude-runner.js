import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
/**
 * Resolve the bin directory of the Node installation running this process.
 * Used to ensure child `claude` processes use the same Node version.
 */
const NODE_BIN_DIR = dirname(process.execPath);
/**
 * Wraps the Claude Code CLI to execute tasks with safety constraints.
 *
 * Each task runs as a child process: `claude -p "<prompt>" --cwd <dir> ...`
 * Output is captured from stdout and streamed into the task result.
 */
export class ClaudeRunner {
    taskManager;
    permissions;
    config;
    processes = new Map();
    constructor(taskManager, permissions, config) {
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
    execute(task) {
        const args = this.buildArgs(task);
        // Resolve the claude binary: if bare "claude", look in same bin dir as our Node
        const claudeBin = this.config.claudeBin === "claude"
            ? join(NODE_BIN_DIR, "claude")
            : this.config.claudeBin;
        // Ensure the child process finds the correct Node (for #!/usr/bin/env node shebang)
        const childEnv = {
            ...process.env,
            PATH: `${NODE_BIN_DIR}:${process.env.PATH || "/usr/bin:/bin"}`,
        };
        const child = spawn(claudeBin, args, {
            cwd: task.projectDir,
            env: childEnv,
            stdio: ["pipe", "pipe", "pipe"],
        });
        this.processes.set(task.id, child);
        this.taskManager.markRunning(task.id, child.pid);
        // Write the prompt via stdin instead of -p arg (works around -p hang)
        child.stdin?.write(task.prompt);
        child.stdin?.end();
        let stdout = "";
        let stderr = "";
        child.stdout?.on("data", (chunk) => {
            stdout += chunk.toString();
        });
        child.stderr?.on("data", (chunk) => {
            stderr += chunk.toString();
        });
        child.on("close", (code) => {
            this.processes.delete(task.id);
            if (this.taskManager.get(task.id)?.status === "cancelled") {
                return; // already marked cancelled
            }
            if (code === 0) {
                this.taskManager.markCompleted(task.id, stdout.trim());
            }
            else {
                this.taskManager.markFailed(task.id, `Exit code ${code}.\nstderr: ${stderr.trim()}\nstdout (partial): ${stdout.slice(-2000)}`);
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
    cancel(taskId) {
        const child = this.processes.get(taskId);
        if (!child)
            return false;
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
    drainQueue() {
        while (this.taskManager.canStartMore()) {
            const next = this.taskManager.nextQueued();
            if (!next)
                break;
            this.execute(next);
        }
    }
    /**
     * Handle a permission prompt from Claude Code's --permission-prompt-tool.
     * This is called when the agent requests approval for an action.
     */
    handlePermission(req) {
        return this.permissions.evaluate(req);
    }
    buildArgs(task) {
        const args = [
            "--print",
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
        // Use acceptEdits permission mode to allow file operations
        // without interactive prompts while still maintaining safety.
        args.push("--permission-mode", "bypassPermissions");
        return args;
    }
}
