import { defineConfig, mergeConfig } from "vitest/config"
import base from "../vitest.config.mts"

export default mergeConfig(base, defineConfig({
  test: {
    include: ["scripts/wallet-database.integration.ts"],
    exclude: [],
    passWithNoTests: false,
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 30_000,
  },
}))
