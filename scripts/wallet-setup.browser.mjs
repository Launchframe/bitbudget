import { createHash, randomBytes, webcrypto } from "node:crypto"
import { createServer } from "node:net"
import { spawn } from "node:child_process"
import { readFile } from "node:fs/promises"
import { chromium, expect } from "@playwright/test"
import { PrismaClient } from "@prisma/client"

const fixture = process.env.WALLET_DATABASE_FIXTURE
if (!fixture || !process.env.WALLET_TEST_DATABASE_URL || process.env.WALLET_TEST_DATABASE_URL !== process.env.DATABASE_URL) throw new Error("Run through the isolated wallet database fixture")
const dbUrl = new URL(process.env.DATABASE_URL)
if (dbUrl.hostname !== "127.0.0.1" || dbUrl.pathname !== "/wallet_test") throw new Error("Refusing a non-fixture database")
const prisma = new PrismaClient()
const listener = createServer()
await new Promise(resolve => listener.listen(0, "127.0.0.1", resolve))
const port = listener.address().port
await new Promise(resolve => listener.close(resolve))
const origin = `http://localhost:${port}`
const privacyKey = randomBytes(32)
const salt = randomBytes(16), iv = randomBytes(12)
const material = await webcrypto.subtle.importKey("raw", new TextEncoder().encode("synthetic budget password"), "PBKDF2", false, ["deriveKey"])
const wrappingKey = await webcrypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 600000 }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt"])
const encrypted = await webcrypto.subtle.encrypt({ name: "AES-GCM", iv }, wrappingKey, privacyKey)
const interrupt = process.env.WALLET_TEST_INTERRUPT_DKG === "true"
const unsupported = process.env.WALLET_TEST_UNSUPPORTED_PRF === "true"
const email = `wallet-browser-${unsupported ? "unsupported-" : interrupt ? "resume-" : ""}${fixture}@bitbudget.test`
const user = await prisma.user.create({ data: {
  email, onboardingComplete: true, walkthroughCompleted: true, opportunityCostEnabled: true,
  encryptedPrivacyKey: JSON.stringify({ iv: iv.toString("hex"), ciphertext: Buffer.from(encrypted).toString("hex") }), privacyKeySalt: salt.toString("hex"),
} })
await prisma.envelope.create({ data: { userId: user.id, name: "Savings", monthlyAllotment: 0, color: "#D4AF37", systemRole: "savings" } })
const env = { ...process.env, NODE_ENV: "development", E2E_TEST: "true", E2E_EMAIL_CODE: "424242", AUTH_SECRET: randomBytes(32).toString("hex"), AUTH_TRUST_HOST: "true", AUTH_URL: origin, NEXTAUTH_URL: origin, WALLET_NETWORK: "regtest", WALLET_WEBAUTHN_RP_ID: "localhost", WALLET_WEBAUTHN_ORIGINS: origin }
const server = spawn("pnpm", ["exec", "next", "dev", "-p", String(port), "-H", "127.0.0.1"], { env, stdio: ["ignore", "pipe", "pipe"], detached: true })
let serverReady = false
server.stdout.on("data", chunk => { if (chunk.toString().includes("Ready in")) serverReady = true })
server.stderr.on("data", () => {})
let browser
let page
const responseStatuses = []
try {
  for (let attempt = 0; attempt < 180 && !serverReady; attempt++) {
    if (server.exitCode !== null) throw new Error("Fixture Next server exited before readiness")
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  if (!serverReady) throw new Error("Fixture Next server did not start")
  browser = await chromium.launch({ headless: true, executablePath: process.env.WALLET_PLAYWRIGHT_CHROMIUM || undefined })
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: interrupt ? 320 : 390, height: 844 }, serviceWorkers: interrupt ? "block" : "allow" })
  let interruptedDkg = false
  if (interrupt) await context.route(/\/api\/wallets\/[^/]+\/dkg$/, route => {
    if (!interruptedDkg && route.request().method() === "POST") { interruptedDkg = true; return route.abort("failed") }
    return route.continue()
  })
  await context.addInitScript(({ userId, key }) => {
    localStorage.setItem("bitbudget-privacy-key", key)
    localStorage.setItem("bitbudget-privacy-user", userId)
    localStorage.setItem("bitbudget-privacy-unlock-expires", String(Date.now() + 3600000))
    window.__walletPrfProof = { create: 0, get: 0, results: 0 }
    for (const operation of ["create", "get"]) {
      const original = navigator.credentials[operation].bind(navigator.credentials)
      navigator.credentials[operation] = async (...args) => {
        const credential = await original(...args)
        if (credential?.type === "public-key") {
          window.__walletPrfProof[operation]++
          if (credential.getClientExtensionResults().prf?.results?.first?.byteLength === 32) window.__walletPrfProof.results++
        }
        return credential
      }
    }
  }, { userId: user.id, key: privacyKey.toString("hex") })
  page = await context.newPage()
  page.on("response", response => { const pathname = new URL(response.url()).pathname; if (pathname.startsWith("/api/wallets") || pathname.includes(".wasm")) responseStatuses.push({ path: pathname.replace(/[a-f0-9-]{36}/g, "wallet-id"), method: response.request().method(), status: response.status(), contentType: response.headers()["content-type"] }) })
  const cdp = await context.newCDPSession(page)
  await cdp.send("WebAuthn.enable", { enableUI: false })
  await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", ctap2Version: "ctap2_1", transport: "internal", hasResidentKey: true, hasUserVerification: true, hasPrf: !unsupported, automaticPresenceSimulation: true, isUserVerified: true } })
  const requests = []
  page.on("request", request => {
    if (new URL(request.url()).pathname.startsWith("/api/wallets") && request.method() === "POST") requests.push(request.postData() ?? "")
  })
  page.setDefaultTimeout(30000)
  await page.goto(`${origin}/auth`)
  await page.getByRole("button", { name: "Email", exact: true }).click()
  await page.getByPlaceholder("you@example.com").fill(email)
  await page.getByRole("button", { name: "Send Login Code" }).click()
  await page.getByPlaceholder("000000").fill("424242")
  await page.getByRole("button", { name: "Continue", exact: true }).click()
  await page.waitForURL(url => !url.pathname.startsWith("/auth"), { timeout: 60000 })
  await page.goto(`${origin}/#/wallet`)
  await expect(page.getByRole("button", { name: "Create wallet", exact: true })).toBeEnabled({ timeout: 90000 })
  await page.getByRole("button", { name: "Create wallet", exact: true }).click()
  await page.getByRole("button", { name: "Continue to protection" }).click()
  await page.getByLabel("Wallet name", { exact: true }).fill("Natively verified wallet")
  const password = "synthetic browser recovery password"
  await page.getByLabel("Recovery password (at least 12 characters)", { exact: true }).fill(password)
  await page.getByLabel("Confirm recovery password", { exact: true }).fill(password)
  await page.getByRole("button", { name: "Create wallet with passkey" }).click()
  if (unsupported) {
    await expect(page.locator('[data-wallet-error-code="passkey-encryption-unavailable"]')).toBeVisible({ timeout: 60000 })
    expect(await prisma.walletAccount.count({ where: { userId: user.id } })).toBe(0)
    expect(await prisma.walletCredential.count({ where: { userId: user.id } })).toBe(0)
    const native = await page.evaluate(() => window.__walletPrfProof)
    expect(native.results).toBe(0)
    expect(requests.some(body => body.includes("aBroadcastHex"))).toBe(false)
    console.log(JSON.stringify({ result: "passed", scenario: "native-authenticator-without-PRF", walletCount: 0, native }))
  } else {
  const recoveryHeading = page.getByRole("heading", { name: "Save and verify your recovery file" })
  await recoveryHeading.or(page.locator('[data-wallet-setup] [role="alert"]')).first().waitFor({ state: "visible", timeout: 120000 })
  await expect(recoveryHeading).toBeVisible({ timeout: 1000 })
  const record = await prisma.walletAccount.findFirstOrThrow({ where: { userId: user.id } })
  let earlierNative = { create: 0, get: 0, results: 0 }
  if (interrupt) {
    expect(interruptedDkg).toBe(true)
    expect(record.status).toBe("provisioning")
    earlierNative = await page.evaluate(() => window.__walletPrfProof)
    await page.reload()
    await page.getByRole("button", { name: "Continue setup", exact: true }).click()
    await page.getByRole("button", { name: "Finish saving wallet", exact: true }).click()
    await expect(page.getByRole("button", { name: "Download recovery file", exact: true })).toBeEnabled({ timeout: 60000 })
  }
  expect((await prisma.walletAccount.findUniqueOrThrow({ where: { id: record.id } })).status).toBe("recovery-required")
  expect(record.recoveryVerifiedAt).toBeNull()
  expect(await prisma.walletAccount.count({ where: { userId: user.id } })).toBe(1)
  const downloaded = page.waitForEvent("download")
  await page.getByRole("button", { name: "Download recovery file", exact: true }).click()
  const file = await downloaded
  const contents = await readFile(await file.path(), "utf8")
  expect(contents.includes(password)).toBe(false)
  expect(JSON.parse(contents).context.role).toBe("C")
  await page.getByLabel("Reopen the saved recovery file").setInputFiles({ name: file.suggestedFilename(), mimeType: "application/json", buffer: Buffer.from(contents) })
  await page.getByLabel("Recovery password", { exact: true }).fill("deliberately wrong recovery password")
  await page.getByRole("button", { name: "Verify recovery file", exact: true }).click()
  await expect(page.getByRole("alert").filter({ hasText: "could not be verified" })).toBeVisible({ timeout: 60000 })
  expect((await prisma.walletAccount.findUniqueOrThrow({ where: { id: record.id } })).status).toBe("recovery-required")
  await page.getByLabel("Recovery password", { exact: true }).fill(password)
  await page.getByRole("button", { name: "Verify recovery file", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Wallet created. Recovery verified." })).toBeVisible({ timeout: 60000 })
  const verified = await prisma.walletAccount.findUniqueOrThrow({ where: { id: record.id } })
  expect(verified.recoveryVerifiedAt).not.toBeNull()
  expect(verified.recoveryFileHash).toBe(createHash("sha256").update(contents).digest("hex"))
  const lastNative = await page.evaluate(() => window.__walletPrfProof)
  const counts = { create: earlierNative.create + lastNative.create, get: earlierNative.get + lastNative.get, results: earlierNative.results + lastNative.results }
  expect(counts.create).toBe(1)
  expect(counts.results).toBeGreaterThanOrEqual(3)
  for (const body of requests) {
    expect(body.includes(password)).toBe(false)
    expect(/"(?:prf|prfOutput|shareA|shareC|password|seedHex)"/.test(body)).toBe(false)
  }
  await page.getByRole("button", { name: "Open wallet", exact: true }).click()
  await page.reload()
  await expect(page.getByRole("heading", { name: "Natively verified wallet", exact: true })).toBeVisible({ timeout: 60000 })
  await expect(page.getByText("Recovery verified · signing locked", { exact: true })).toBeVisible()
  expect(await prisma.walletAccount.count({ where: { userId: user.id } })).toBe(1)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  console.log(JSON.stringify({ result: "passed", browser: await browser.version(), actualWebAuthn: counts, creation: "real browser worker WASM + authenticated Next APIs + PostgreSQL", recovery: "download, failed password, re-import, actual A+C proof, reload", walletCount: 1, indexerConfigured: false, interruptedDkg, viewport: interrupt ? 320 : 390 }))
  }
} catch (error) {
  if (page) console.error(JSON.stringify({ stage: "wallet-browser-flow-failed", alerts: await page.locator('[data-wallet-setup] [role="alert"]').allTextContents().catch(() => []), code: await page.locator('[data-wallet-setup] [role="alert"]').first().getAttribute("data-wallet-error-code").catch(() => null), responses: responseStatuses, native: await page.evaluate(() => window.__walletPrfProof).catch(() => null) }))
  throw error
} finally {
  privacyKey.fill(0)
  await browser?.close()
  await prisma.$disconnect()
  if (server.pid) {
    try { process.kill(-server.pid, "SIGTERM") } catch {}
    await new Promise(resolve => { if (server.exitCode !== null) resolve(); else { const timer = setTimeout(() => { try { process.kill(-server.pid, "SIGKILL") } catch {} resolve() }, 10000); server.once("exit", () => { clearTimeout(timer); resolve() }) } })
  }
}
