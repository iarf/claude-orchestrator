import { z } from "zod";
import { TaskManager } from "./task-manager.js";
import { ClaudeRunner } from "./claude-runner.js";
import { PermissionEngine } from "./permissions.js";
export declare const DispatchTaskSchema: z.ZodObject<{
    prompt: z.ZodString;
    projectDir: z.ZodString;
    maxTurns: z.ZodDefault<z.ZodOptional<z.ZodNumber>>;
    allowedTools: z.ZodOptional<z.ZodArray<z.ZodString>>;
}, z.core.$strip>;
export declare const GetStatusSchema: z.ZodObject<{
    taskId: z.ZodString;
}, z.core.$strip>;
export declare const GetResultSchema: z.ZodObject<{
    taskId: z.ZodString;
    tailLines: z.ZodDefault<z.ZodOptional<z.ZodNumber>>;
}, z.core.$strip>;
export declare const CancelTaskSchema: z.ZodObject<{
    taskId: z.ZodString;
}, z.core.$strip>;
export declare const ListTasksSchema: z.ZodObject<{
    status: z.ZodDefault<z.ZodOptional<z.ZodEnum<{
        queued: "queued";
        running: "running";
        completed: "completed";
        failed: "failed";
        cancelled: "cancelled";
        all: "all";
    }>>>;
}, z.core.$strip>;
export declare function getToolDefinitions(): ({
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: {
            prompt: {
                type: string;
                description: string | undefined;
            };
            projectDir: {
                type: string;
                description: string | undefined;
            };
            maxTurns: {
                type: string;
                description: string;
            };
            allowedTools: {
                type: string;
                items: {
                    type: string;
                };
                description: string;
            };
            taskId?: undefined;
            tailLines?: undefined;
            status?: undefined;
        };
        required: string[];
    };
} | {
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: {
            taskId: {
                type: string;
                description: string;
            };
            prompt?: undefined;
            projectDir?: undefined;
            maxTurns?: undefined;
            allowedTools?: undefined;
            tailLines?: undefined;
            status?: undefined;
        };
        required: string[];
    };
} | {
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: {
            taskId: {
                type: string;
                description: string;
            };
            tailLines: {
                type: string;
                description: string;
            };
            prompt?: undefined;
            projectDir?: undefined;
            maxTurns?: undefined;
            allowedTools?: undefined;
            status?: undefined;
        };
        required: string[];
    };
} | {
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: {
            status: {
                type: string;
                enum: string[];
                description: string;
            };
            prompt?: undefined;
            projectDir?: undefined;
            maxTurns?: undefined;
            allowedTools?: undefined;
            taskId?: undefined;
            tailLines?: undefined;
        };
        required: never[];
    };
} | {
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: {
            prompt?: undefined;
            projectDir?: undefined;
            maxTurns?: undefined;
            allowedTools?: undefined;
            taskId?: undefined;
            tailLines?: undefined;
            status?: undefined;
        };
        required: never[];
    };
})[];
export declare function createToolHandler(taskManager: TaskManager, runner: ClaudeRunner, permissions: PermissionEngine): (name: string, args: Record<string, unknown>) => Promise<{
    content: {
        type: "text";
        text: string;
    }[];
    isError: boolean;
} | {
    content: {
        type: "text";
        text: string;
    }[];
    isError?: undefined;
}>;
