import { createHash, webcrypto } from "node:crypto"
import { readFileSync } from "node:fs"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { createContext, runInContext } from "node:vm"
import { afterEach, describe, expect, it, vi } from "vitest"
import { buildWalletAssetManifest, parseClientReferenceManifest, walletModuleGroup } from "../../scripts/build-wallet-asset-manifest.mjs"

const origin = "https://budget.test"
const manifestUrl = `${origin}/wallet-asset-manifest.json`
const assetPath = "/_next/static/chunks/0123456789abcdef.js"
const secondPath = "/_next/static/chunks/fedcba9876543210.js"
const code = "globalThis.walletCodeLoaded = true;"
const prefix = "bitbudget-wallet-assets-v1-"
const source = readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8")
const sha256 = (body: string) => createHash("sha256").update(body).digest("hex")
const asset = (url = assetPath, body = code) => ({
  url, sha256: sha256(body), bytes: Buffer.byteLength(body), mime: "application/javascript",
  modules: ["[project]/lib/wallet/monitor-entry.ts"],
})
const makeManifest = (assets = [asset()]) => {
  const payload = {
    schema: 1, discovery: "partial-client-reference-graph", buildId: "production-build",
    groups: { monitor: { complete: false, assets }, signer: { complete: false, assets: [] }, blake2b: { complete: false, assets: [] }, advanced: { complete: false, assets: [] } },
  }
  return { ...payload, version: sha256(JSON.stringify(payload)) }
}

function responseAt(url: string, body: string, init: ResponseInit = {}, type = "basic", redirected = false): Response {
  const wrap = (response: Response): Response => {
    const clone = response.clone.bind(response)
    Object.defineProperties(response, {
      url: { value: url }, type: { value: type }, redirected: { value: redirected },
      clone: { value: () => wrap(clone()) },
    })
    return response
  }
  return wrap(new Response(body, { status: 200, headers: { "content-type": "application/javascript", "cache-control": "public, max-age=31536000, immutable" }, ...init }))
}

type CacheStore = Map<string, Map<string, Response>>
function harness(manifest = makeManifest(), store: CacheStore = new Map()) {
  const handlers = new Map<string, (event: Record<string, unknown>) => void>()
  const responses = new Map<string, Response>([
    [manifestUrl, responseAt(manifestUrl, JSON.stringify(manifest), { headers: { "content-type": "application/json" } })],
    [`${origin}${assetPath}`, responseAt(`${origin}${assetPath}`, code)],
    [`${origin}${secondPath}`, responseAt(`${origin}${secondPath}`, code)],
  ])
  const fetch = vi.fn(async (input: Request | string) => {
    const url = typeof input === "string" ? input : input.url
    const response = responses.get(url)
    if (!response) throw new Error("offline")
    return response.clone()
  })
  const beforePut = vi.fn(async () => {})
  const cacheApi = {
    keys: vi.fn(async () => [...store.keys()]),
    delete: vi.fn(async (name: string) => store.delete(name)),
    open: vi.fn(async (name: string) => {
      if (!store.has(name)) store.set(name, new Map())
      const entries = store.get(name)!
      return {
        match: async (url: string) => entries.get(url)?.clone(),
        put: async (url: string, response: Response) => { await beforePut(); entries.set(url, response.clone()) },
        delete: async (url: string) => entries.delete(url),
      }
    }),
  }
  const clients = { matchAll: vi.fn(async () => [{ id: "wallet-client", url: `${origin}/` }, { id: "vanilla-client", url: `${origin}/` }]), openWindow: vi.fn() }
  const notification = vi.fn()
  const context = createContext({
    self: { location: { origin }, clients, registration: { showNotification: notification }, addEventListener: (type: string, callback: (event: Record<string, unknown>) => void) => handlers.set(type, callback) },
    clients, caches: cacheApi, fetch, crypto: webcrypto, URL, TextDecoder, TextEncoder, Uint8Array, AbortSignal,
  })
  runInContext(source, context)
  return {
    store, responses, fetch, cacheApi, handlers, clients, notification, context, beforePut,
    async message(data: unknown = { type: "wallet-assets-cache", group: "monitor", reason: "opt-in" }, overrides: Record<string, unknown> = {}) {
      const reply = vi.fn()
      let completion: Promise<unknown> = Promise.resolve()
      handlers.get("message")!({ data, origin, source: { id: "wallet-client" }, ports: [{ postMessage: reply }], waitUntil: (promise: Promise<unknown>) => { completion = promise }, ...overrides })
      await completion
      return reply.mock.calls.at(-1)?.[0]
    },
    async request(url = `${origin}${assetPath}`, init: RequestInit = {}, clientId = "wallet-client") {
      let completion: Promise<Response> | undefined
      handlers.get("fetch")!({ request: new Request(url, init), clientId, respondWith: (promise: Promise<Response>) => { completion = promise } })
      return completion!
    },
  }
}

describe("wallet service worker cache boundary", () => {
  it("has no install/activation precache, forced update or normal-fetch cache writes", async () => {
    const worker = harness()
    expect([...worker.handlers.keys()].sort()).toEqual(["fetch", "message", "notificationclick", "push"])
    expect(await (await worker.request()).text()).toBe(code)
    expect(worker.store.size).toBe(0)
    expect(worker.cacheApi.open).not.toHaveBeenCalled()
    expect(worker.fetch).toHaveBeenCalledOnce()
    expect(worker.fetch).not.toHaveBeenCalledWith(manifestUrl, expect.anything())
  })

  it("caches only verified explicit artifacts, serves cache hits without executing code and reports partial", async () => {
    const worker = harness()
    expect(await worker.message()).toEqual({ status: "partial", group: "monitor", cachedAssets: 1 })
    expect(worker.store.size).toBe(1)
    expect([...worker.store.values()][0].size).toBe(1)
    expect(worker.fetch).toHaveBeenNthCalledWith(1, manifestUrl, expect.objectContaining({ credentials: "omit", redirect: "error", cache: "no-store" }))
    worker.fetch.mockClear()
    worker.responses.clear()
    expect(await (await worker.request()).text()).toBe(code)
    expect(worker.fetch).not.toHaveBeenCalled()
    expect(runInContext("globalThis.walletCodeLoaded", worker.context)).toBeUndefined()
    await expect(worker.request(`${origin}${assetPath}`, {}, "vanilla-client")).rejects.toThrow("offline")
  })

  it.each([
    { data: { type: "wallet-assets-cache", group: "monitor", reason: "opt-in", url: "https://evil.test/file.js" } },
    { data: { type: "wallet-assets-cache", group: "/api/auth/session", reason: "demand" } },
    { data: { type: "wallet-assets-cache", group: "monitor", reason: "automatic" } },
    { origin: "https://evil.test" }, { source: { id: "uncontrolled" } }, { source: null }, { ports: [] },
  ])("rejects untrusted messages before fetching: %j", async (overrides) => {
    const worker = harness()
    expect(await worker.message(undefined, overrides)).toBeUndefined()
    expect(worker.fetch).not.toHaveBeenCalled()
    expect(worker.store.size).toBe(0)
  })

  it("requires the controlled client's own URL to be same-origin", async () => {
    const worker = harness()
    worker.clients.matchAll.mockResolvedValue([{ id: "wallet-client", url: "https://evil.test/" }])
    expect(await worker.message()).toBeUndefined()
    expect(worker.fetch).not.toHaveBeenCalled()
  })

  it.each([
    "/api/auth/session", "/api/wallet", "/wallet", "/recovery", "/node/status", "/private/psbt", "/_next/static/chunks/0123456789abcdef.js?token=secret", "/_next/static/chunks/aaaaaaaaaaaaaaaa.js", "/_next/static/chunks/0123456789abcdef.js#private",
  ])("keeps nonallowlisted/private URLs network-only: %s", async (pathname) => {
    const worker = harness()
    await worker.message()
    const url = `${origin}${pathname}`
    worker.responses.set(url, responseAt(url, "private", { headers: { "content-type": "text/html" } }))
    worker.fetch.mockClear()
    expect(await (await worker.request(url)).text()).toBe("private")
    expect(worker.fetch).toHaveBeenCalledOnce()
    expect([...worker.store.values()][0].size).toBe(1)
  })

  it.each<RequestInit>([
    { method: "POST", body: "psbt" },
    { headers: { authorization: "Bearer private" } }, { headers: { range: "bytes=0-2" } },
    { headers: { rsc: "1" } }, { headers: { "next-router-state-tree": "private" } },
    { headers: { accept: "text/html" } }, { headers: { accept: "text/x-component" } },
  ])("bypasses even an allowlisted path for sensitive request variants: %j", async (init) => {
    const worker = harness()
    await worker.message()
    worker.responses.clear()
    await expect(worker.request(`${origin}${assetPath}`, init)).rejects.toThrow("offline")
    expect([...worker.store.values()][0].size).toBe(1)
  })

  it.each<ResponseInit>([
    { status: 404 }, { status: 500 }, { status: 206 },
    { headers: { "content-type": "text/html", "cache-control": "immutable" } },
    { headers: { "content-type": "text/x-component", "cache-control": "immutable" } },
    { headers: { "content-type": "application/javascript" } },
    { headers: { "content-type": "application/javascript", "cache-control": "private, immutable" } },
    { headers: { "content-type": "application/javascript", "cache-control": "no-store, immutable" } },
    { headers: { "content-type": "application/javascript", "cache-control": "immutable", "content-range": "bytes 0-3/99" } },
    { headers: { "content-type": "application/javascript", "cache-control": "immutable", vary: "RSC" } },
    { headers: { "content-type": "application/javascript", "cache-control": "immutable", "content-length": "9000000" } },
  ])("rejects nonimmutable/error/private/partial/oversized responses: %j", async (init) => {
    const worker = harness()
    worker.responses.set(`${origin}${assetPath}`, responseAt(`${origin}${assetPath}`, code, init))
    expect((await worker.message()).status).toBe("unavailable")
    expect(worker.store.size).toBe(0)
  })

  it.each(["opaque", "cors", "opaqueredirect"])("rejects response type %s", async (type) => {
    const worker = harness()
    worker.responses.set(`${origin}${assetPath}`, responseAt(`${origin}${assetPath}`, code, {}, type))
    expect((await worker.message()).status).toBe("unavailable")
  })

  it("rejects redirected or wrong final URLs and integrity mismatches", async () => {
    for (const response of [responseAt(`${origin}${assetPath}`, code, {}, "basic", true), responseAt(`${origin}/api/private`, code), responseAt(`${origin}${assetPath}`, "x".repeat(code.length)), responseAt(`${origin}${assetPath}`, `${code}extra`)]) {
      const worker = harness()
      worker.responses.set(`${origin}${assetPath}`, response)
      expect((await worker.message()).status).toBe("unavailable")
      expect(worker.store.size).toBe(0)
    }
  })

  it("does not commit a partially downloaded group or claim missing groups ready", async () => {
    const worker = harness(makeManifest([asset(), asset(secondPath)]))
    worker.responses.delete(`${origin}${secondPath}`)
    expect((await worker.message()).status).toBe("unavailable")
    expect(worker.store.size).toBe(0)
    expect(await worker.message({ type: "wallet-assets-cache", group: "signer", reason: "demand" })).toEqual({ status: "unavailable", group: "signer", cachedAssets: 0 })
  })

  it.each(["https://evil.test/a.js", "/api/psbt.js", "/_next/static/chunks/0123456789abcdef.js?private=1", "/_next/static/chunks/../private.js"])("rejects manifest URL injection: %s", async (url) => {
    const worker = harness(makeManifest([asset(url)]))
    expect((await worker.message()).status).toBe("unavailable")
    expect(worker.fetch).toHaveBeenCalledOnce()
    expect(worker.store.size).toBe(0)
  })

  it("fails closed on missing, malformed, stale-hash, HTML and falsely complete manifests", async () => {
    const variants = [responseAt(manifestUrl, "missing", { status: 404 }), responseAt(manifestUrl, "<html/>", { headers: { "content-type": "text/html" } }), responseAt(manifestUrl, "{", { headers: { "content-type": "application/json" } })]
    for (const response of variants) {
      const worker = harness()
      worker.responses.set(manifestUrl, response)
      expect((await worker.message()).status).toBe("unavailable")
      expect(worker.store.size).toBe(0)
    }
    const manifest = makeManifest()
    manifest.groups.monitor.complete = true
    expect((await harness(manifest).message()).status).toBe("unavailable")
    const changed = makeManifest()
    changed.groups.monitor.assets[0].sha256 = "f".repeat(64)
    expect((await harness(changed).message()).status).toBe("unavailable")
  })

  it("bounds own versions and never touches key/data caches", async () => {
    const manifest = makeManifest()
    const worker = harness(manifest)
    worker.store.set(`${prefix}${"f".repeat(64)}`, new Map())
    worker.store.set("wallet-private-keys", new Map())
    worker.store.set("bitbudget-wallet-assets-other-version", new Map())
    await worker.message()
    expect([...worker.store.keys()].sort()).toEqual([`${prefix}${manifest.version}`, "wallet-private-keys", "bitbudget-wallet-assets-other-version"].sort())
  })

  it("does not reuse persisted artifacts in a fresh worker before explicit demand", async () => {
    const first = harness()
    await first.message()
    const restarted = harness(makeManifest(), first.store)
    restarted.responses.delete(`${origin}${assetPath}`)
    await expect(restarted.request()).rejects.toThrow("offline")
    expect((await restarted.message()).status).toBe("partial")
    expect(await (await restarted.request()).text()).toBe(code)
  })

  it("rolls back new group writes on quota failure without deleting unrelated caches", async () => {
    const worker = harness(makeManifest([asset(), asset(secondPath)]))
    worker.store.set("wallet-private-keys", new Map())
    worker.beforePut.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("quota"))
    expect((await worker.message()).status).toBe("unavailable")
    expect([...worker.store.keys()]).toEqual(["wallet-private-keys"])
  })

  it.each([
    [asset(), asset()],
    [{ ...asset(), bytes: 4 * 1024 * 1024 + 1 }],
    [{ ...asset(), bytes: 0 }],
    [{ ...asset(), modules: ["[project]/lib/private-keys.ts"] }],
    [{ ...asset(), sha256: "not-a-hash" }],
    [{ ...asset(), mime: "text/html" }],
  ])("rejects duplicate, over-budget and invalid artifact metadata: %j", async (...assets) => {
    const worker = harness(makeManifest(assets))
    expect((await worker.message()).status).toBe("unavailable")
    expect(worker.fetch).toHaveBeenCalledOnce()
    expect(worker.store.size).toBe(0)
  })

  it("rejects corrupt cached artifacts instead of executing them", async () => {
    const worker = harness()
    await worker.message()
    const entries = [...worker.store.values()][0]
    entries.set(`${origin}${assetPath}`, responseAt(`${origin}${assetPath}`, "tampered"))
    worker.responses.clear()
    await expect(worker.request()).rejects.toThrow("offline")
    expect(entries.size).toBe(0)
  })

  it("preserves push and notification-click behavior", () => {
    const worker = harness()
    const waitUntil = vi.fn()
    worker.handlers.get("push")!({ data: { json: () => ({ title: "Reminder", body: "Budget", url: "/budget" }) }, waitUntil })
    expect(worker.notification).toHaveBeenCalledWith("Reminder", { body: "Budget", icon: "/icon-vanilla.svg", badge: "/icon-vanilla.svg", data: { url: "/budget" } })
    const close = vi.fn()
    worker.handlers.get("notificationclick")!({ notification: { close, data: { url: "/budget" } }, waitUntil })
    expect(close).toHaveBeenCalledOnce()
    expect(worker.clients.openWindow).toHaveBeenCalledWith("/budget")
  })
})

const temporaryRoots: string[] = []
afterEach(async () => { await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })

async function buildFixture(modules: Record<string, { chunks: string[] }>) {
  const root = await mkdtemp(path.join(tmpdir(), "wallet-manifest-test-"))
  temporaryRoots.push(root)
  await mkdir(path.join(root, ".next/server/app"), { recursive: true })
  await mkdir(path.join(root, ".next/static/chunks"), { recursive: true })
  await writeFile(path.join(root, ".next/BUILD_ID"), "production-build")
  await writeFile(path.join(root, ".next/turbopack"), "")
  await writeFile(path.join(root, ".next/server/app/page_client-reference-manifest.js"), `globalThis.__RSC_MANIFEST = globalThis.__RSC_MANIFEST || {};\nglobalThis.__RSC_MANIFEST["/page"] = ${JSON.stringify({ clientModules: modules })}`)
  await writeFile(path.join(root, ".next/static/chunks/0123456789abcdef.js"), code)
  return root
}

describe("production graph artifact manifest generator", () => {
  it("derives exact file URLs and SHA256 from observed Next client-module records, not guessed chunks", async () => {
    const root = await buildFixture({ "[project]/lib/wallet/monitor-entry.ts": { chunks: [assetPath] } })
    const manifest = await buildWalletAssetManifest(root)
    expect(manifest).toEqual(makeManifest())
    expect(manifest.groups.monitor.complete).toBe(false)
  })

  it("does not execute build manifest JavaScript", () => {
    expect(() => parseClientReferenceManifest("globalThis.compromised = true")).toThrow("Unsupported")
    expect(walletModuleGroup("[project]/lib/wallet/monitor-entry.ts")).toBe("monitor")
    expect(walletModuleGroup("[project]/lib/wallet/signer/index.ts <module evaluation>")).toBe("signer")
    expect(walletModuleGroup("[project]/components/app-shell.tsx")).toBeNull()
  })

  it("rejects builds without explicit wallet evidence instead of producing an empty success", async () => {
    const root = await buildFixture({ "[project]/components/app-shell.tsx": { chunks: [assetPath] } })
    await expect(buildWalletAssetManifest(root)).rejects.toThrow("No exclusive wallet")
  })

  it("excludes shared vanilla/other-group chunks", async () => {
    const root = await buildFixture({ "[project]/lib/wallet/monitor-entry.ts": { chunks: [assetPath] }, "[project]/components/app-shell.tsx": { chunks: [assetPath] } })
    await expect(buildWalletAssetManifest(root)).rejects.toThrow("No exclusive wallet")
  })

  it("requires real production files and rejects arbitrary graph paths", async () => {
    const root = await buildFixture({ "[project]/lib/wallet/monitor-entry.ts": { chunks: [secondPath] } })
    await expect(buildWalletAssetManifest(root)).rejects.toThrow()
    const invalid = await buildFixture({ "[project]/lib/wallet/monitor-entry.ts": { chunks: ["/api/private.js"] } })
    await expect(buildWalletAssetManifest(invalid)).rejects.toThrow("No exclusive wallet")
    await rm(path.join(root, ".next/BUILD_ID"))
    await expect(buildWalletAssetManifest(root)).rejects.toThrow()
  })
})
