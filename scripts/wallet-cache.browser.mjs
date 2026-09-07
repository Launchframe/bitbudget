import { randomBytes, webcrypto } from "node:crypto"
import { createServer, request as proxyRequest } from "node:http"
import { createServer as portListener } from "node:net"
import { spawn } from "node:child_process"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { chromium, expect } from "@playwright/test"
import { PrismaClient } from "@prisma/client"

const fixture = process.env.WALLET_DATABASE_FIXTURE
if (!/^[a-f0-9]{16}$/.test(fixture ?? "") || !process.env.WALLET_TEST_DATABASE_URL || process.env.WALLET_TEST_DATABASE_URL !== process.env.DATABASE_URL) throw new Error("Use the isolated wallet database fixture")
const database = new URL(process.env.DATABASE_URL)
if (database.hostname !== "127.0.0.1" || database.pathname !== "/wallet_test") throw new Error("Refusing a non-fixture database")
const manifest = JSON.parse(await readFile("public/wallet-asset-manifest.json", "utf8"))
if (manifest.schema !== 2 || manifest.buildId !== (await readFile(".next/BUILD_ID", "utf8")).trim() || !manifest.groups.monitor.complete || !manifest.groups.signer.complete) throw new Error("Build the complete production wallet asset manifest first")
const artifacts = new Map(Object.values(manifest.groups).flatMap(group => group.assets).map(asset => [asset.url, asset]))
const walletOnly = new Set([...artifacts.values()].filter(asset => !asset.sharedWithApp).map(asset => asset.url))
const prisma = new PrismaClient()
const profile = await mkdtemp(path.join(tmpdir(), "bitbudget-wallet-cache-"))
const privacyKey = randomBytes(32)
let context
let application
let proxy
let page
let denyWalletAssets = false
const requests = new Map()

async function freePort() {
  const listener = portListener()
  await new Promise(resolve => listener.listen(0, "127.0.0.1", resolve))
  const port = listener.address().port
  await new Promise(resolve => listener.close(resolve))
  return port
}

async function demand(page, group) {
  return page.evaluate(group => new Promise((resolve, reject) => {
    const channel = new MessageChannel()
    const timeout = setTimeout(() => reject(new Error("Asset cache acknowledgement timeout")), 60000)
    channel.port1.onmessage = event => { clearTimeout(timeout); channel.port1.close(); resolve(event.data) }
    navigator.serviceWorker.controller.postMessage({ type: "wallet-assets-cache", group, reason: "demand" }, [channel.port2])
  }), group)
}

async function compileWorkerWasm(page, url) {
  return page.evaluate(url => new Promise((resolve, reject) => {
    const source = `onmessage = async event => { try { const response = await fetch(event.data); const bytes = await response.arrayBuffer(); await WebAssembly.compile(bytes); const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), value => value.toString(16).padStart(2, "0")).join(""); postMessage({ digest, bytes: bytes.byteLength }); } catch { postMessage({ error: true }); } }`
    const blob = URL.createObjectURL(new Blob([source], { type: "application/javascript" }))
    const worker = new Worker(blob)
    const timer = setTimeout(() => { worker.terminate(); URL.revokeObjectURL(blob); reject(new Error("WASM worker timeout")) }, 30000)
    worker.onmessage = event => { clearTimeout(timer); worker.terminate(); URL.revokeObjectURL(blob); resolve(event.data) }
    worker.onerror = () => { clearTimeout(timer); worker.terminate(); URL.revokeObjectURL(blob); reject(new Error("WASM worker failed")) }
    worker.postMessage(url)
  }), url)
}

try {
  const backendPort = await freePort()
  proxy = createServer((request, response) => {
    const pathname = new URL(request.url, "http://localhost").pathname
    if (pathname.startsWith("/_next/static/")) requests.set(pathname, (requests.get(pathname) ?? 0) + 1)
    if (denyWalletAssets && walletOnly.has(pathname)) { response.writeHead(503); response.end("Wallet asset network access blocked by restart test"); return }
    const upstream = proxyRequest({ hostname: "127.0.0.1", port: backendPort, path: request.url, method: request.method, headers: { ...request.headers, "x-forwarded-host": request.headers.host, "x-forwarded-proto": "http" } }, upstream => {
      response.writeHead(upstream.statusCode, upstream.headers)
      upstream.pipe(response)
    })
    upstream.on("error", () => { if (!response.headersSent) response.writeHead(502); response.end() })
    request.pipe(upstream)
  })
  await new Promise(resolve => proxy.listen(0, "127.0.0.1", resolve))
  const origin = `http://localhost:${proxy.address().port}`
  const salt = randomBytes(16), iv = randomBytes(12)
  const material = await webcrypto.subtle.importKey("raw", new TextEncoder().encode("synthetic cache fixture password"), "PBKDF2", false, ["deriveKey"])
  const key = await webcrypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 600000 }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt"])
  const encrypted = await webcrypto.subtle.encrypt({ name: "AES-GCM", iv }, key, privacyKey)
  const email = `wallet-cache-${fixture}@bitbudget.test`
  const user = await prisma.user.create({ data: { email, onboardingComplete: true, walkthroughCompleted: true, opportunityCostEnabled: false, encryptedPrivacyKey: JSON.stringify({ iv: iv.toString("hex"), ciphertext: Buffer.from(encrypted).toString("hex") }), privacyKeySalt: salt.toString("hex") } })
  await prisma.envelope.create({ data: { userId: user.id, name: "Savings", monthlyAllotment: 0, color: "#D4AF37", systemRole: "savings" } })
  const env = { ...process.env, NODE_ENV: "production", E2E_TEST: "true", E2E_EMAIL_CODE: "424242", AUTH_SECRET: randomBytes(32).toString("hex"), AUTH_TRUST_HOST: "true", AUTH_URL: origin, NEXTAUTH_URL: origin }
  let ready = false
  application = spawn("pnpm", ["exec", "next", "start", "-p", String(backendPort), "-H", "127.0.0.1"], { env, detached: true, stdio: ["ignore", "pipe", "pipe"] })
  application.stdout.on("data", chunk => { if (chunk.toString().includes("Ready in")) ready = true })
  application.stderr.on("data", () => {})
  for (let attempt = 0; attempt < 120 && !ready; attempt++) {
    if (application.exitCode !== null) throw new Error("Production fixture exited")
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  if (!ready) throw new Error("Production fixture failed to start")
  const launch = async () => {
    const browser = await chromium.launchPersistentContext(profile, { headless: true, executablePath: process.env.WALLET_PLAYWRIGHT_CHROMIUM || undefined, viewport: { width: 390, height: 844 } })
    await browser.addInitScript(({ id, key }) => {
      localStorage.setItem("bitbudget-privacy-key", key)
      localStorage.setItem("bitbudget-privacy-user", id)
      localStorage.setItem("bitbudget-privacy-unlock-expires", String(Date.now() + 3600000))
    }, { id: user.id, key: privacyKey.toString("hex") })
    const page = await browser.newPage()
    const cdp = await browser.newCDPSession(page)
    await cdp.send("Network.enable")
    await cdp.send("Network.setCacheDisabled", { cacheDisabled: true })
    page.setDefaultTimeout(60000)
    return { browser, page }
  }
  ;({ browser: context, page } = await launch())
  await page.goto(`${origin}/auth`)
  await page.getByRole("button", { name: "Email", exact: true }).click()
  await page.getByPlaceholder("you@example.com").fill(email)
  await page.getByRole("button", { name: "Send Login Code" }).click()
  await page.getByPlaceholder("000000").fill("424242")
  await page.getByRole("button", { name: "Continue", exact: true }).click()
  await page.waitForURL(url => !url.pathname.startsWith("/auth"))
  await page.waitForLoadState("networkidle")
  expect([...requests.keys()].filter(url => walletOnly.has(url))).toEqual([])
  expect(await page.evaluate(() => caches.keys())).toEqual([])
  const mode = await page.request.put(`${origin}/api/user/settings`, { data: { opportunityCostEnabled: true } })
  expect(mode.ok()).toBe(true)
  await page.reload()
  await page.waitForLoadState("networkidle")
  await page.evaluate(async () => { await navigator.serviceWorker.ready })
  await page.goto(`${origin}/#/wallet`)
  await expect(page.locator('[data-wallet-feature="entry"]')).toBeVisible()
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true)
  const monitored = await demand(page, "monitor")
  expect(monitored.status).toBe("cached")
  const signerExclusive = new Set(manifest.groups.signer.assets.filter(asset => !manifest.groups.monitor.assets.some(monitor => monitor.url === asset.url) && !asset.sharedWithApp).map(asset => asset.url))
  expect([...requests.keys()].filter(url => signerExclusive.has(url))).toEqual([])
  await page.getByRole("button", { name: "Public data tools", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Public data tools", exact: true })).toBeVisible()
  expect((await demand(page, "signer")).status).toBe("cached")
  const wasm = manifest.groups.signer.assets.find(asset => asset.mime === "application/wasm")
  expect(wasm).toBeTruthy()
  requests.clear()
  expect(await compileWorkerWasm(page, `${origin}${wasm.url}`)).toEqual({ digest: wasm.sha256, bytes: wasm.bytes })
  expect([...requests.keys()].filter(url => walletOnly.has(url))).toEqual([])
  const cachedBefore = await page.evaluate(async () => {
    const entries = []
    for (const name of await caches.keys()) for (const request of await (await caches.open(name)).keys()) entries.push(new URL(request.url).pathname)
    return entries.sort()
  })
  expect(cachedBefore.every(url => artifacts.has(url))).toBe(true)
  expect(cachedBefore.includes(wasm.url)).toBe(true)
  await context.close()
  context = null
  denyWalletAssets = true
  requests.clear()
  ;({ browser: context, page } = await launch())
  await page.goto(`${origin}/#/wallet`)
  await expect(page.locator('[data-wallet-feature="entry"]')).toBeVisible()
  await page.getByRole("button", { name: "Public data tools", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Public data tools", exact: true })).toBeVisible()
  expect((await demand(page, "signer")).status).toBe("cached")
  expect(await compileWorkerWasm(page, `${origin}${wasm.url}`)).toEqual({ digest: wasm.sha256, bytes: wasm.bytes })
  expect([...requests.keys()].filter(url => walletOnly.has(url))).toEqual([])
  expect(await prisma.walletAccount.count({ where: { userId: user.id } })).toBe(0)
  console.log(JSON.stringify({ result: "passed", scenario: "production-app-full-browser-restart", browser: context.browser().version(), cachedAssets: cachedBefore.length, walletNetworkRequestsAfterRestart: 0, httpCacheDisabled: true, wasmVerifiedInWorker: true, vanillaWalletDownloads: 0 }))
} catch (error) {
  console.error(JSON.stringify({ scenario: "wallet-cache-failed", deniedAssetRequests: [...requests.keys()].filter(url => denyWalletAssets && walletOnly.has(url)) }))
  throw error
} finally {
  privacyKey.fill(0)
  await context?.close()
  await prisma.$disconnect()
  if (application?.pid) {
    try { process.kill(-application.pid, "SIGTERM") } catch {}
    await new Promise(resolve => { if (application.exitCode !== null) resolve(); else { const timer = setTimeout(() => { try { process.kill(-application.pid, "SIGKILL") } catch {} resolve() }, 10000); application.once("exit", () => { clearTimeout(timer); resolve() }) } })
  }
  if (proxy) { proxy.closeAllConnections(); await new Promise(resolve => proxy.close(resolve)) }
  await rm(profile, { recursive: true, force: true })
}
