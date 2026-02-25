/**
 * Policy decision for a permission request.
 * - "allow": auto-approve
 * - "deny": reject with reason
 * - "escalate": surface to the user for manual approval
 */
export type PolicyDecision = {
    action: "allow";
} | {
    action: "deny";
    reason: string;
} | {
    action: "escalate";
    reason: string;
};
export interface PermissionRequest {
    tool: string;
    filePath?: string;
    command?: string;
}
export interface PermissionEngineConfig {
    /** Directories the agent is allowed to operate in (absolute paths). */
    allowedPaths: string[];
    /** Tools the agent is never allowed to use. */
    blockedTools?: string[];
    /** Bash command patterns that are always denied (regex strings). */
    blockedCommands?: string[];
    /** Tools that are auto-approved without path checking. */
    safeTools?: string[];
}
export declare class PermissionEngine {
    private config;
    constructor(config: PermissionEngineConfig);
    evaluate(req: PermissionRequest): PolicyDecision;
    private isPathAllowed;
    /** Returns a summary of the current policy for logging/debugging. */
    describePolicy(): object;
}
