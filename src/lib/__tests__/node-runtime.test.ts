import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const root = process.cwd();
const base = "node:22.23.4-alpine@sha256:0e1754758c2df4cfa3e68d59e2e1b7374bb7fd9ea6328eaaacf15cc934af8202";

describe("supported Node runtime", () => {
  it("pins all three Docker stages to the same patched immutable image", () => {
    const dockerfile = readFileSync(path.join(root, "Dockerfile"), "utf8");
    const stages = [...dockerfile.matchAll(/^FROM (\S+) AS (\S+)$/gm)];
    expect(stages.map((stage) => stage[1])).toEqual([base, base, base]);
    expect(stages.map((stage) => stage[2])).toEqual(["deps", "builder", "runner"]);
  });

  it("uses the same exact Node release locally, in CI, and in this test", () => {
    expect(readFileSync(path.join(root, ".nvmrc"), "utf8").trim()).toBe("22.23.4");
    const workflow = readFileSync(path.join(root, ".github/workflows/ci.yml"), "utf8");
    expect(workflow).toContain("node-version: '22.23.4'");
    expect(workflow).toContain("timeout-minutes: 15");
    expect(process.version).toBe("v22.23.4");
  });

  it("loads the native SQLite binding and preserves a transactional in-memory row", () => {
    const sqlite = new Database(":memory:");
    try {
      sqlite.exec("CREATE TABLE runtime_probe (id INTEGER PRIMARY KEY, value TEXT NOT NULL)");
      sqlite.transaction(() => sqlite.prepare("INSERT INTO runtime_probe VALUES (?, ?)").run(1, "synthetic"))();
      expect(sqlite.prepare("SELECT id, value FROM runtime_probe").get()).toEqual({ id: 1, value: "synthetic" });
      expect(sqlite.pragma("integrity_check", { simple: true })).toBe("ok");
    } finally {
      sqlite.close();
    }
  });
});
