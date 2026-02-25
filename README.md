# claude-code-orchestrator

An MCP server that lets you dispatch and manage Claude Code agents from Cowork (or any MCP client). Tasks run asynchronously with path-scoped permissions so agents can't operate outside your designated project directories.

## Architecture

```
┌──────────────────┐     stdio/MCP      ┌─────────────────────┐
│  Claude Cowork   │ ◄────────────────► │    Orchestrator     │
│  (MCP client)    │                    │    (MCP server)     │
└──────────────────┘                    └────────┬────────────┘
                                                 │
                                    ┌────────────┼────────────┐
                                    ▼            ▼            ▼
                              ┌──────────┐ ┌──────────┐ ┌──────────┐
                              │ claude -p│ │ claude -p│ │ claude -p│
                              │ agent 1  │ │ agent 2  │ │ agent 3  │
                              └──────────┘ └──────────┘ └──────────┘
                                   │            │            │
                                   ▼            ▼            ▼
                              /project/a   /project/a   /project/b
```

## Quick Start

```bash
# Install dependencies
npm install

# Build
npm run build

# Test it manually (requires claude CLI installed)
ORCHESTRATOR_ALLOWED_PATHS=/path/to/your/project node dist/index.js
```

## Configuration

Create `orchestrator.config.json` in the project root, your CWD, or `~/.claude/`:

```json
{
  "allowedPaths": [
    "/home/you/projects/myapp",
    "/home/you/projects/api"
  ],
  "maxConcurrent": 4,
  "defaultMaxTurns": 30,
  "claudeBin": "claude",
  "model": "",
  "blockedTools": ["WebFetch", "WebSearch"],
  "blockedCommands": ["npm\\s+publish", "git\\s+push"]
}
```

Or use environment variables:

```bash
ORCHESTRATOR_ALLOWED_PATHS=/path/a:/path/b
ORCHESTRATOR_MAX_CONCURRENT=4
ORCHESTRATOR_MAX_TURNS=30
ORCHESTRATOR_CLAUDE_BIN=claude
ORCHESTRATOR_MODEL=claude-sonnet-4-5-20250929
```

## Connecting to Cowork

Add to your Claude Desktop `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "orchestrator": {
      "command": "node",
      "args": ["/absolute/path/to/claude-code-orchestrator/dist/index.js"],
      "env": {
        "ORCHESTRATOR_ALLOWED_PATHS": "/home/you/projects/myapp"
      }
    }
  }
}
```

Or if using Claude Code, add to `.mcp.json` in your project:

```json
{
  "mcpServers": {
    "orchestrator": {
      "command": "node",
      "args": ["./path/to/claude-code-orchestrator/dist/index.js"],
      "env": {
        "ORCHESTRATOR_ALLOWED_PATHS": "/home/you/projects/myapp"
      }
    }
  }
}
```

## Tools

### `dispatch_task`
Send a task to a Claude Code agent. Returns immediately with a task ID.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `prompt` | string | yes | What you want the agent to do |
| `projectDir` | string | yes | Absolute path to the project directory |
| `maxTurns` | number | no | Max agent turns (default 30) |
| `allowedTools` | string[] | no | Tool whitelist for this agent |

### `get_status`
Check a task's current state: queued, running, completed, failed, or cancelled.

### `get_result`
Get the agent's output. Use `tailLines` to control how much output is returned.

### `list_tasks`
List all tasks, optionally filtered by status.

### `cancel_task`
Kill a running agent or remove a queued task.

### `get_policy`
Inspect the current permission policy (allowed paths, blocked tools/commands).

## Safety Layers

### Path Scoping
Every `dispatch_task` call validates that `projectDir` is within your configured `allowedPaths`. The permission engine also inspects file paths in tool calls and bash commands to prevent path escape.

### Blocked Commands
Default blocked patterns prevent destructive operations:
- `rm -rf /`, `sudo`, `chmod`, `chown`
- `curl | sh`, `wget | sh` (pipe-to-shell)
- `ssh`, `scp`, remote `rsync`
- `npm publish`, `git push`
- Filesystem destructive ops (`mkfs`, `dd`)

Add your own patterns via `blockedCommands` in config.

### Tool Blocking
Block specific Claude Code tools via `blockedTools`. For example, `["WebFetch", "WebSearch"]` prevents network access.

### Concurrency Limits
`maxConcurrent` caps how many agents run simultaneously. Tasks beyond the limit are queued and auto-started when capacity frees up.

### Turn Limits
`maxTurns` per task (default 30) prevents runaway agents. The Claude Code `--max-turns` flag enforces this at the CLI level.

## Hardening (Optional)

For stronger isolation, wrap the `claudeBin` with a Docker entrypoint:

```bash
#!/bin/bash
# claude-docker-wrapper.sh
docker run --rm \
  -v "$1":/workspace:rw \
  -v ~/.claude:/root/.claude:ro \
  --network=none \
  your-claude-image \
  claude -p "$2" --cwd /workspace --max-turns "$3" --dangerously-skip-permissions
```

Then set `"claudeBin": "./claude-docker-wrapper.sh"` in config. Each agent runs in a network-isolated container with only the project directory mounted.

## Example Cowork Session

```
You: dispatch a task to implement the authentication middleware
     in /home/ian/projects/myapp

Cowork → dispatch_task({
  prompt: "Implement JWT authentication middleware in src/middleware/auth.ts...",
  projectDir: "/home/ian/projects/myapp",
  maxTurns: 30
})

→ { taskId: "abc-123", status: "running" }

You: how's the auth task going?

Cowork → get_status({ taskId: "abc-123" })

→ { status: "running", startedAt: "..." }

You: what did it produce?

Cowork → get_result({ taskId: "abc-123" })

→ { status: "completed", output: "Created src/middleware/auth.ts with..." }
```

## License

MIT
