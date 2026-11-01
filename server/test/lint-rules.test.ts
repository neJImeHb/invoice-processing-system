import path from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

function serverRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

function fixturePath(): string {
  return path.resolve(serverRoot(), "test", "fixtures", "lint-violations.ts");
}

function errorRuleIds(results: ESLint.LintResult[]): string[] {
  const ids: string[] = [];
  for (const result of results) {
    for (const message of result.messages) {
      const ruleId = message.ruleId;
      if (message.severity === 2 && ruleId !== null) {
        ids.push(ruleId);
      }
    }
  }
  return ids;
}

describe("eslint rules", () => {
  it("reports explicit any and empty blocks on the lint fixture", async () => {
    const eslint = new ESLint({
      cwd: serverRoot(),
      ignore: false,
    });
    const results = await eslint.lintFiles([fixturePath()]);
    const ids = errorRuleIds(results);

    expect(ids).toContain("@typescript-eslint/no-explicit-any");
    expect(ids).toContain("no-empty");
  });
});
