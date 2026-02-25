/**
 * Server configuration loaded from a JSON file or environment variables.
 */
export interface ServerConfig {
    /** Directories the agents are allowed to work in. */
    allowedPaths: string[];
    /** Max concurrent agent processes. Default 4. */
    maxConcurrent: number;
    /** Default max turns per task. Default 30. */
    defaultMaxTurns: number;
    /** Path to the `claude` binary. Default "claude". */
    claudeBin: string;
    /** Model override (e.g., "claude-sonnet-4-5-20250929"). Empty = CLI default. */
    model: string;
    /** Additional tools to block. */
    blockedTools: string[];
    /** Additional bash command patterns to block (regex strings). */
    blockedCommands: string[];
}
/**
 * Load config from (in priority order):
 * 1. ORCHESTRATOR_CONFIG env var pointing to a JSON file
 * 2. ./orchestrator.config.json in CWD
 * 3. ~/.claude/orchestrator.config.json
 * 4. Defaults (which require allowedPaths to be set via env)
 */
export declare function loadConfig(): ServerConfig;
