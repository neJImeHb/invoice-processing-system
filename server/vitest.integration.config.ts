import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.integration.test.ts"],
    exclude: [
      "**/node_modules/**",
      "**/.git/**",
      "test/chat.integration.test.ts",
      "test/agent-actions.integration.test.ts",
      "test/pipeline.integration.test.ts",
      "test/pipeline-failure.integration.test.ts",
    ],
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 300_000,
    hookTimeout: 300_000,
  },
});
