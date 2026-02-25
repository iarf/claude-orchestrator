import path from "node:path";
const DEFAULT_BLOCKED_COMMANDS = [
    "rm\\s+-rf\\s+/", // rm -rf / or similar
    "sudo\\s+", // any sudo usage
    "chmod\\s+", // permission changes
    "chown\\s+", // ownership changes
    "curl.*\\|.*sh", // pipe-to-shell
    "wget.*\\|.*sh",
    "mkfs", // filesystem destructive ops
    "dd\\s+",
    ">(\\s+)/dev/", // writing to devices
    "ssh\\s+", // no remote access
    "scp\\s+",
    "rsync\\s+.*:", // remote rsync
    "npm\\s+publish", // no publishing
    "git\\s+push", // no pushing (you review first)
    "docker\\s+", // no container ops from inside agent
];
const DEFAULT_SAFE_TOOLS = ["Read", "Glob", "Grep"];
export class PermissionEngine {
    config;
    constructor(config) {
        this.config = {
            allowedPaths: config.allowedPaths.map((p) => path.resolve(p)),
            blockedTools: config.blockedTools ?? [],
            blockedCommands: [
                ...DEFAULT_BLOCKED_COMMANDS,
                ...(config.blockedCommands ?? []),
            ],
            safeTools: config.safeTools ?? DEFAULT_SAFE_TOOLS,
        };
    }
    evaluate(req) {
        // 1. Blocked tools — hard deny
        if (this.config.blockedTools.includes(req.tool)) {
            return { action: "deny", reason: `Tool "${req.tool}" is blocked by policy.` };
        }
        // 2. Safe read-only tools — auto-approve if path is in scope (or no path)
        if (this.config.safeTools.includes(req.tool)) {
            if (!req.filePath || this.isPathAllowed(req.filePath)) {
                return { action: "allow" };
            }
            return {
                action: "deny",
                reason: `Path "${req.filePath}" is outside allowed directories.`,
            };
        }
        // 3. Bash commands — check against blocked patterns
        if (req.tool === "Bash" && req.command) {
            for (const pattern of this.config.blockedCommands) {
                if (new RegExp(pattern).test(req.command)) {
                    return {
                        action: "deny",
                        reason: `Command matches blocked pattern: ${pattern}`,
                    };
                }
            }
            // If the command seems to target a path, check it
            const pathMatch = req.command.match(/(?:^|\s)(\/[\w./-]+)/g);
            if (pathMatch) {
                for (const match of pathMatch) {
                    const extracted = match.trim();
                    if (!this.isPathAllowed(extracted)) {
                        return {
                            action: "deny",
                            reason: `Command references path "${extracted}" outside allowed directories.`,
                        };
                    }
                }
            }
            return { action: "allow" };
        }
        // 4. File-modifying tools (Edit, Write, etc.) — must be in allowed paths
        if (req.filePath) {
            if (this.isPathAllowed(req.filePath)) {
                return { action: "allow" };
            }
            return {
                action: "deny",
                reason: `Path "${req.filePath}" is outside allowed directories.`,
            };
        }
        // 5. Anything we can't categorize — escalate
        return {
            action: "escalate",
            reason: `Unknown tool "${req.tool}" requires manual review.`,
        };
    }
    isPathAllowed(filePath) {
        const resolved = path.resolve(filePath);
        return this.config.allowedPaths.some((allowed) => resolved === allowed || resolved.startsWith(allowed + path.sep));
    }
    /** Returns a summary of the current policy for logging/debugging. */
    describePolicy() {
        return {
            allowedPaths: this.config.allowedPaths,
            blockedTools: this.config.blockedTools,
            blockedCommandPatterns: this.config.blockedCommands.length,
            safeTools: this.config.safeTools,
        };
    }
}
