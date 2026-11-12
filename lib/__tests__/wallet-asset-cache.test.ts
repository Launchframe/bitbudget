import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cacheWalletAssets, type WalletAssetGroup } from "@/lib/wallet-asset-cache"

const origin = "https://budget.test"
let channels: MockChannel[]
let postMessage: ReturnType<typeof vi.fn>

class MockChannel {
  port1 = { onmessage: null as ((event: { data: unknown }) => void) | null, onmessageerror: null as (() => void) | null, close: vi.fn() }
  port2 = { close: vi.fn() }
  constructor() { channels.push(this) }
}

beforeEach(() => {
  channels = []
  postMessage = vi.fn(() => queueMicrotask(() => channels.at(-1)?.port1.onmessage?.({
    data: { status: "partial", group: "monitor", cachedAssets: 1 },
  })))
  vi.stubGlobal("window", { isSecureContext: true, location: { origin } })
  vi.stubGlobal("navigator", { serviceWorker: { controller: { scriptURL: `${origin}/sw.js`, postMessage } } })
  vi.stubGlobal("MessageChannel", MockChannel)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe("wallet code cache helper", () => {
  it("does nothing without explicit enablement", async () => {
    expect(await cacheWalletAssets("monitor", { enabled: false, reason: "opt-in" })).toEqual({ status: "disabled", group: "monitor", cachedAssets: 0 })
    expect(channels).toHaveLength(0)
    expect(postMessage).not.toHaveBeenCalled()
  })

  it("sends only a fixed group and explicit demand, never a URL, account or runtime request", async () => {
    expect(await cacheWalletAssets("monitor", { enabled: true, reason: "demand" })).toEqual({ status: "partial", group: "monitor", cachedAssets: 1 })
    expect(postMessage).toHaveBeenCalledWith({ type: "wallet-assets-cache", group: "monitor", reason: "demand" }, [channels[0].port2])
    expect(channels[0].port1.close).toHaveBeenCalledOnce()
    expect(channels[0].port2.close).toHaveBeenCalledOnce()
  })

  it.each(["/api/wallet", "https://evil.test/file.js", "__proto__"])("rejects invalid groups: %s", async (group) => {
    expect((await cacheWalletAssets(group as WalletAssetGroup, { enabled: true, reason: "opt-in" })).status).toBe("unavailable")
    expect(postMessage).not.toHaveBeenCalled()
  })

  it("does not register, activate, wait for or reload an uncontrolled page", async () => {
    vi.stubGlobal("navigator", { serviceWorker: { controller: null } })
    expect((await cacheWalletAssets("monitor", { enabled: true, reason: "demand" })).status).toBe("unavailable")
    expect(channels).toHaveLength(0)
  })

  it.each(["https://other.test/sw.js", `${origin}/other-sw.js`])("rejects unexpected controller %s", async (scriptURL) => {
    vi.stubGlobal("navigator", { serviceWorker: { controller: { scriptURL, postMessage } } })
    expect((await cacheWalletAssets("monitor", { enabled: true, reason: "demand" })).status).toBe("unavailable")
    expect(postMessage).not.toHaveBeenCalled()
  })

  it("is safe during SSR and without a secure context", async () => {
    vi.stubGlobal("window", undefined)
    expect((await cacheWalletAssets("monitor", { enabled: true, reason: "demand" })).status).toBe("unavailable")
    vi.stubGlobal("window", { isSecureContext: false })
    expect((await cacheWalletAssets("monitor", { enabled: true, reason: "demand" })).status).toBe("unavailable")
  })

  it.each([
    { status: "ready", group: "monitor", cachedAssets: 1 },
    { status: "partial", group: "signer", cachedAssets: 1 },
    { status: "partial", group: "monitor", cachedAssets: 0 },
    { status: "partial", group: "monitor", cachedAssets: 65 },
    { status: "partial", group: "monitor", cachedAssets: 1.5 },
    null,
  ])("never reports runtime readiness from malformed/partial replies: %j", async (data) => {
    postMessage.mockImplementation(() => queueMicrotask(() => channels[0].port1.onmessage?.({ data })))
    expect((await cacheWalletAssets("monitor", { enabled: true, reason: "demand" })).status).toBe("unavailable")
  })

  it("bounds waiting and closes ports", async () => {
    vi.useFakeTimers()
    postMessage.mockImplementation(() => {})
    const result = cacheWalletAssets("monitor", { enabled: true, reason: "demand" })
    await vi.advanceTimersByTimeAsync(60000)
    expect((await result).status).toBe("unavailable")
    expect(channels[0].port1.close).toHaveBeenCalledOnce()
  })

  it("tolerates postMessage and decoding failures", async () => {
    postMessage.mockImplementation(() => { throw new Error("closed") })
    expect((await cacheWalletAssets("monitor", { enabled: true, reason: "demand" })).status).toBe("unavailable")
    postMessage.mockImplementation(() => queueMicrotask(() => channels.at(-1)?.port1.onmessageerror?.()))
    expect((await cacheWalletAssets("monitor", { enabled: true, reason: "demand" })).status).toBe("unavailable")
  })
})
