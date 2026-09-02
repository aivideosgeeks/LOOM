import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 180_000,
    fileParallelism: false,
    env: {
      NODE_ENV: "test",
      SEED_ON_START: "false",
      RISK_SCAN_ON_START: "false",
      EMBEDDINGS_PROVIDER: "none",
    },
  },
});
