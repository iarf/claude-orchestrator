import fs from "node:fs";
import path from "node:path";
const DEFAULT_CONFIG = {
    allowedPaths: [],
    maxConcurrent: 4,
    defaultMaxTurns: 30,
    claudeBin: "claude",
    model: "",
    blockedTools: [],
    blockedCommands: [],
};
/**
 * Load config from (in priority order):
 * 1. ORCHESTRATOR_CONFIG env var pointing to a JSON file
 * 2. ./orchestrator.config.json in CWD
 * 3. ~/.claude/orchestrator.config.json
 * 4. Defaults (which require allowedPaths to be set via env)
 */
export function loadConfig() {
    // Try config file locations
    const candidates = [
        process.env.ORCHESTRATOR_CONFIG,
        path.join(process.cwd(), "orchestrator.config.json"),
        path.join(process.env.HOME || process.env.USERPROFILE || "", ".claude", "orchestrator.config.json"),
    ].filter(Boolean);
    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
            const raw = fs.readFileSync(candidate, "utf-8");
            const parsed = JSON.parse(raw);
            const merged = { ...DEFAULT_CONFIG, ...parsed };
            // Resolve all paths to absolute
            merged.allowedPaths = merged.allowedPaths.map((p) => path.resolve(p));
            return merged;
        }
    }
    // Fall back to env vars
    const envPaths = process.env.ORCHESTRATOR_ALLOWED_PATHS;
    if (envPaths) {
        return {
            ...DEFAULT_CONFIG,
            allowedPaths: envPaths.split(":").map((p) => path.resolve(p)),
            maxConcurrent: parseInt(process.env.ORCHESTRATOR_MAX_CONCURRENT || "4", 10),
            defaultMaxTurns: parseInt(process.env.ORCHESTRATOR_MAX_TURNS || "30", 10),
            claudeBin: process.env.ORCHESTRATOR_CLAUDE_BIN || "claude",
            model: process.env.ORCHESTRATOR_MODEL || "",
        };
    }
    return DEFAULT_CONFIG;
}
