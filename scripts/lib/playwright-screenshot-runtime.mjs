/**
 * Playwright launcher + output paths for shopping QA screenshot scripts.
 */
import { createRequire } from "node:module"
import { accessSync } from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, "../..")

const PLAYWRIGHT_INSTALL_HINT =
  "Playwright not found. Install browsers with: pnpm exec playwright install chromium"

export function defaultScreenshotOutDir() {
  if (process.env.OUT_DIR) return process.env.OUT_DIR
  const cloudArtifacts = "/opt/cursor/artifacts"
  try {
    accessSync(cloudArtifacts)
    return cloudArtifacts
  } catch {
    return path.join(REPO_ROOT, "test-results/shopping-qa-screenshots")
  }
}

/**
 * Load Chromium from this repo's @playwright/test dependency (not a cloud-only pnpm path).
 */
export async function loadPlaywrightChromium() {
  const require = createRequire(import.meta.url)
  let playwrightPkgDir
  try {
    const pwTestPkg = require.resolve("@playwright/test/package.json", {
      paths: [REPO_ROOT],
    })
    playwrightPkgDir = path.dirname(
      require.resolve("playwright/package.json", { paths: [path.dirname(pwTestPkg)] }),
    )
  } catch {
    try {
      playwrightPkgDir = path.dirname(
        require.resolve("playwright/package.json", { paths: [REPO_ROOT] }),
      )
    } catch {
      playwrightPkgDir = undefined
    }
  }
  if (!playwrightPkgDir) {
    throw new Error(PLAYWRIGHT_INSTALL_HINT)
  }
  const playwrightMod = await import(
    pathToFileURL(path.join(playwrightPkgDir, "index.js")).href
  )
  const chromium = playwrightMod.chromium ?? playwrightMod.default?.chromium
  if (!chromium) throw new Error(PLAYWRIGHT_INSTALL_HINT)
  return chromium
}
