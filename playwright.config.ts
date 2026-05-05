import path from "node:path"
import dotenv from "dotenv"
import { defineConfig, devices } from "@playwright/test"

// Load before globalSetup / workers so DATABASE_URL, AUTH_SECRET, etc. match `pnpm dev`.
dotenv.config({ path: path.resolve(".env.local") })
dotenv.config({ path: path.resolve(".env") })

const e2ePort = process.env.PW_SERVER_PORT || "3100"
const e2eOrigin = `http://127.0.0.1:${e2ePort}`

const e2eWebServerEnv = {
  ...process.env,
  E2E_TEST: "true",
  E2E_EMAIL_CODE: process.env.E2E_EMAIL_CODE?.trim() || "424242",
  PORT: e2ePort,
  HOSTNAME: "127.0.0.1",
  /** Auth.js: allow sign-in on the Playwright server origin (not production). */
  AUTH_TRUST_HOST: "true",
  AUTH_URL: e2eOrigin,
  NEXTAUTH_URL: e2eOrigin,
}

/**
 * `next dev` takes an exclusive `.next/dev/lock`; a second dev (e.g. Playwright) fails if you already
 * have `pnpm dev` running. Production `next start` after `next build` avoids that lock.
 *
 * GitHub Actions runs `pnpm exec next build` as its own step (full logs on failure), then sets
 * **`PW_WEBSERVER_SKIP_BUILD=true`** so Playwright only runs **`next start`** here.
 */
const skipWebServerBuild = process.env.PW_WEBSERVER_SKIP_BUILD === "true"

const webServerCommand =
  process.env.PW_WEBSERVER_COMMAND?.trim() ||
  (skipWebServerBuild
    ? `pnpm exec next start -p ${e2ePort} -H 127.0.0.1`
    : `pnpm exec next build && pnpm exec next start -p ${e2ePort} -H 127.0.0.1`)

/**
 * Playwright only forwards webServer output to the terminal when stdout/stderr are **pipe**
 * (see `webServerPlugin.js`: `inherit` never gates `onStdOut`/`onStdErr`).
 * Alternatively: `DEBUG=pw:webserver pnpm test:e2e`.
 */
const webServerLogs =
  process.env.PW_WEBSERVER_STDIO === "ignore"
    ? ({ stdout: "ignore", stderr: "ignore" } as const)
    : ({ stdout: "pipe", stderr: "pipe" } as const)

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  /** `list` echoes `[WebServer]` lines from piped stdout/stderr; `github` annotates the Actions UI. */
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  timeout: 60_000,
  use: {
    ...devices["Desktop Chrome"],
    baseURL: process.env.PLAYWRIGHT_BASE_URL || e2eOrigin,
    trace: "on-first-retry",
  },
  webServer: {
    command: webServerCommand,
    url: `${e2eOrigin}/welcome`,
    reuseExistingServer: false,
    timeout: process.env.CI ? 600_000 : 420_000,
    env: e2eWebServerEnv,
    stdout: webServerLogs.stdout,
    stderr: webServerLogs.stderr,
  },
})
