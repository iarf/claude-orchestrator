import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "../src/config.js";

// We need to manipulate env vars and mock fs for config tests.
// vitest's vi.spyOn is used to mock fs.existsSync and fs.readFileSync.

describe("loadConfig", () => {
  const originalEnv = { ...process.env };
  const originalCwd = process.cwd();

  beforeEach(() => {
    // Clean up relevant env vars before each test
    delete process.env.ORCHESTRATOR_CONFIG;
    delete process.env.ORCHESTRATOR_ALLOWED_PATHS;
    delete process.env.ORCHESTRATOR_MAX_CONCURRENT;
    delete process.env.ORCHESTRATOR_MAX_TURNS;
    delete process.env.ORCHESTRATOR_CLAUDE_BIN;
    delete process.env.ORCHESTRATOR_MODEL;
  });

  afterEach(() => {
    // Restore original env
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  // ── Defaults ────────────────────────────────────────────────────────────

  it("returns defaults when no config file or env vars exist", () => {
    // Mock fs so no config files are found
    vi.spyOn(fs, "existsSync").mockReturnValue(false);

    const config = loadConfig();
    expect(config.allowedPaths).toEqual([]);
    expect(config.maxConcurrent).toBe(4);
    expect(config.defaultMaxTurns).toBe(30);
    expect(config.claudeBin).toBe("claude");
    expect(config.model).toBe("");
    expect(config.blockedTools).toEqual([]);
    expect(config.blockedCommands).toEqual([]);
  });

  // ── Env var fallback ────────────────────────────────────────────────────

  it("loads config from ORCHESTRATOR_ALLOWED_PATHS env var", () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(false);
    process.env.ORCHESTRATOR_ALLOWED_PATHS = "/tmp/proj-a:/tmp/proj-b";

    const config = loadConfig();
    expect(config.allowedPaths).toEqual([
      path.resolve("/tmp/proj-a"),
      path.resolve("/tmp/proj-b"),
    ]);
  });

  it("reads ORCHESTRATOR_MAX_CONCURRENT", () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(false);
    process.env.ORCHESTRATOR_ALLOWED_PATHS = "/tmp";
    process.env.ORCHESTRATOR_MAX_CONCURRENT = "8";

    const config = loadConfig();
    expect(config.maxConcurrent).toBe(8);
  });

  it("reads ORCHESTRATOR_MAX_TURNS", () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(false);
    process.env.ORCHESTRATOR_ALLOWED_PATHS = "/tmp";
    process.env.ORCHESTRATOR_MAX_TURNS = "50";

    const config = loadConfig();
    expect(config.defaultMaxTurns).toBe(50);
  });

  it("reads ORCHESTRATOR_CLAUDE_BIN", () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(false);
    process.env.ORCHESTRATOR_ALLOWED_PATHS = "/tmp";
    process.env.ORCHESTRATOR_CLAUDE_BIN = "/usr/local/bin/claude";

    const config = loadConfig();
    expect(config.claudeBin).toBe("/usr/local/bin/claude");
  });

  it("reads ORCHESTRATOR_MODEL", () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(false);
    process.env.ORCHESTRATOR_ALLOWED_PATHS = "/tmp";
    process.env.ORCHESTRATOR_MODEL = "claude-sonnet-4-5-20250929";

    const config = loadConfig();
    expect(config.model).toBe("claude-sonnet-4-5-20250929");
  });

  // ── Config file loading ─────────────────────────────────────────────────

  it("loads from ORCHESTRATOR_CONFIG env var path", () => {
    const configPath = "/custom/path/config.json";
    process.env.ORCHESTRATOR_CONFIG = configPath;

    const fileContent = JSON.stringify({
      allowedPaths: ["/home/user/proj"],
      maxConcurrent: 6,
      blockedTools: ["WebFetch"],
    });

    vi.spyOn(fs, "existsSync").mockImplementation(
      (p) => p === configPath
    );
    vi.spyOn(fs, "readFileSync").mockReturnValue(fileContent);

    const config = loadConfig();
    expect(config.allowedPaths).toEqual([path.resolve("/home/user/proj")]);
    expect(config.maxConcurrent).toBe(6);
    expect(config.blockedTools).toEqual(["WebFetch"]);
    // Defaults should fill in missing fields
    expect(config.defaultMaxTurns).toBe(30);
    expect(config.claudeBin).toBe("claude");
  });

  it("merges file config with defaults (partial config)", () => {
    process.env.ORCHESTRATOR_CONFIG = "/my/config.json";

    const fileContent = JSON.stringify({
      allowedPaths: ["/proj"],
    });

    vi.spyOn(fs, "existsSync").mockImplementation(
      (p) => p === "/my/config.json"
    );
    vi.spyOn(fs, "readFileSync").mockReturnValue(fileContent);

    const config = loadConfig();
    expect(config.allowedPaths).toEqual([path.resolve("/proj")]);
    expect(config.maxConcurrent).toBe(4);
    expect(config.defaultMaxTurns).toBe(30);
    expect(config.blockedTools).toEqual([]);
    expect(config.blockedCommands).toEqual([]);
  });

  it("resolves relative allowedPaths to absolute in config file", () => {
    process.env.ORCHESTRATOR_CONFIG = "/my/config.json";

    const fileContent = JSON.stringify({
      allowedPaths: ["./relative-dir"],
    });

    vi.spyOn(fs, "existsSync").mockImplementation(
      (p) => p === "/my/config.json"
    );
    vi.spyOn(fs, "readFileSync").mockReturnValue(fileContent);

    const config = loadConfig();
    // Should resolve relative to CWD
    expect(path.isAbsolute(config.allowedPaths[0])).toBe(true);
  });

  // ── Config file priority ────────────────────────────────────────────────

  it("prefers ORCHESTRATOR_CONFIG over CWD config file", () => {
    process.env.ORCHESTRATOR_CONFIG = "/custom/config.json";

    const customContent = JSON.stringify({
      allowedPaths: ["/custom-path"],
      maxConcurrent: 10,
    });

    // Both files exist, but custom should win
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    vi.spyOn(fs, "readFileSync").mockReturnValue(customContent);

    const config = loadConfig();
    // The first candidate that exists is used — ORCHESTRATOR_CONFIG comes first
    expect(config.maxConcurrent).toBe(10);
  });

  // ── Env var defaults when ORCHESTRATOR_ALLOWED_PATHS is set ────────────

  it("uses default maxConcurrent=4 when env var not set", () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(false);
    process.env.ORCHESTRATOR_ALLOWED_PATHS = "/tmp";

    const config = loadConfig();
    expect(config.maxConcurrent).toBe(4);
  });

  it("uses default maxTurns=30 when env var not set", () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(false);
    process.env.ORCHESTRATOR_ALLOWED_PATHS = "/tmp";

    const config = loadConfig();
    expect(config.defaultMaxTurns).toBe(30);
  });
});
