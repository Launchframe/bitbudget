import { afterEach, describe, expect, it, vi } from "vitest"

import { ELECTRUM_READ_METHODS, ElectrumClient, type ElectrumReadMethod, type ElectrumSocket } from "@/lib/wallet/chain/electrum-client"

import { READ_METHODS } from "@/wallet-bridge/protocol.mjs"

class FakeSocket extends EventTarget {
  readyState = 0
  sent: { id: number; method: string; params: unknown[] }[] = []
  send(body: string) { this.sent.push(JSON.parse(body)) }
  close() { this.readyState = 3; this.dispatchEvent(new Event("close")) }
  open() { this.readyState = 1; this.dispatchEvent(new Event("open")) }
  message(data: unknown) { this.dispatchEvent(new MessageEvent("message", { data: typeof data === "string" ? data : JSON.stringify(data) })) }
  reply(id: number, result: unknown) { this.message({ jsonrpc: "2.0", id, result }) }
}

const clients: ElectrumClient[] = []
function setup(options: Partial<ConstructorParameters<typeof ElectrumClient>[0]> = {}) {
  const sockets: FakeSocket[] = []
  const factory = vi.fn(() => {
    const socket = new FakeSocket()
    sockets.push(socket)
    return socket as unknown as ElectrumSocket
  })
  const client = new ElectrumClient({ url: "wss://indexer.example/ws", webSocketFactory: factory, ...options })
  clients.push(client)
  return { client, sockets, factory }
}
const tick = async () => { await Promise.resolve(); await Promise.resolve() }
afterEach(() => { clients.splice(0).forEach(client => client.dispose()); vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs() })

describe("Electrum browser transport", () => {
  it("keeps the packaged bridge read-method allowlist in sync without enabling broadcasting", () => {
    expect([...READ_METHODS].sort()).toEqual([...ELECTRUM_READ_METHODS].sort())
    expect(READ_METHODS).not.toContain("blockchain.transaction.broadcast")
  })
  it("requires explicit local-development opt-in and the actual local browser origin for WS", () => {
    const url = "ws://127.0.0.1:50004/electrum"
    expect(() => setup({ url, allowLoopbackDevelopment: true })).toThrow()
    vi.stubGlobal("window", { location: { origin: "http://localhost:3001" } })
    expect(setup({ url, allowLoopbackDevelopment: true }).client.connection.transport).toBe("ws")
    expect(() => setup({ url })).toThrow()
    vi.stubGlobal("window", { location: { origin: "https://budget.example" } })
    expect(() => setup({ url, allowLoopbackDevelopment: true })).toThrow()
    vi.stubEnv("NODE_ENV", "production")
    vi.stubGlobal("window", { location: { origin: "http://localhost:3001" } })
    expect(() => setup({ url, allowLoopbackDevelopment: true })).toThrow()
  })
  it.each(["tcp://node.example:50001", "tls://node.example:50002", "ssl://node.example:50002", "https://node.example"])("does not pretend %s is browser WebSocket", url => {
    const factory = vi.fn()
    expect(() => new ElectrumClient({ url, webSocketFactory: factory })).toThrow("unsupported-transport")
    expect(factory).not.toHaveBeenCalled()
  })

  it("does not use Node's global WebSocket on a server", async () => {
    const client = new ElectrumClient({ url: "wss://indexer.example" })
    await expect(client.connect()).rejects.toMatchObject({ code: "browser-only" })
    await expect(client.request("server.ping")).rejects.toMatchObject({ code: "browser-only" })
    client.dispose()
  })

  it("correlates concurrent replies and ignores duplicate or unsolicited response IDs", async () => {
    const { client, sockets } = setup()
    const first = client.request("server.ping")
    const second = client.request("server.features")
    sockets[0].open()
    await tick()
    const [a, b] = sockets[0].sent
    sockets[0].reply(b.id, { network: "regtest" })
    sockets[0].reply(b.id, "duplicate")
    sockets[0].reply(98765, "unsolicited")
    sockets[0].reply(a.id, null)
    expect(await first).toBeNull()
    expect(await second).toEqual({ network: "regtest" })
  })

  it("delivers only supported notifications and allows local unsubscribe", async () => {
    const { client, sockets } = setup()
    const listener = vi.fn()
    const unsubscribe = client.onNotification("blockchain.headers.subscribe", listener)
    const connect = client.connect()
    sockets[0].open()
    await connect
    sockets[0].message({ jsonrpc: "2.0", method: "blockchain.headers.subscribe", params: [{ height: 0, hex: "00" }] })
    sockets[0].message({ jsonrpc: "2.0", method: "wallet.secret", params: ["hidden"] })
    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
    sockets[0].message({ jsonrpc: "2.0", method: "blockchain.headers.subscribe", params: [] })
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it("rejects every pending request on disconnect and reconnects without replay or reused IDs", async () => {
    const { client, sockets, factory } = setup()
    const first = client.request("server.ping")
    const second = client.request("server.features")
    const settled = Promise.allSettled([first, second])
    sockets[0].open()
    await tick()
    const oldId = sockets[0].sent[0].id
    sockets[0].close()
    expect((await settled).every(result => result.status === "rejected" && result.reason.code === "disconnected")).toBe(true)
    const next = client.request("server.ping")
    sockets[1].open()
    await tick()
    expect(factory).toHaveBeenCalledTimes(2)
    expect(sockets[1].sent).toHaveLength(1)
    expect(sockets[1].sent[0].id).toBeGreaterThan(oldId)
    sockets[0].reply(oldId, "stale")
    sockets[1].reply(sockets[1].sent[0].id, "fresh")
    expect(await next).toBe("fresh")
  })

  it.each(["not-json", "[]", '{"jsonrpc":"1.0","id":1,"result":true}', '{"jsonrpc":"2.0","id":1,"result":1,"error":{"code":1}}', '{"jsonrpc":"2.0","id":1}', '{"jsonrpc":"2.0","id":1,"error":"private data"}'])("closes on malformed frames %s", frame => {
    const { client, sockets } = setup()
    const pending = client.request("server.ping")
    const assertion = expect(pending).rejects.toMatchObject({ code: "protocol" })
    sockets[0].message(frame)
    return assertion
  })

  it("bounds message size, pending request count, and outgoing data", async () => {
    const { client, sockets } = setup({ maxMessageBytes: 128, maxPendingRequests: 1 })
    const pending = client.request("server.ping")
    const assertion = expect(pending).rejects.toMatchObject({ code: "limit" })
    await expect(client.request("server.ping")).rejects.toMatchObject({ code: "limit" })
    sockets[0].message("x".repeat(129))
    await assertion
    await expect(client.request("server.version", ["x".repeat(129)])).rejects.toMatchObject({ code: "limit" })
  })

  it("does not surface raw RPC errors, close reasons, or connection exceptions", async () => {
    const { client, sockets } = setup()
    const pending = client.request("server.features")
    sockets[0].open()
    await tick()
    sockets[0].message({ jsonrpc: "2.0", id: sockets[0].sent[0].id, error: { code: -1, message: "private wallet address" } })
    await expect(pending).rejects.toThrow("Indexer request failed (remote-error).")
    const failed = setup({ webSocketFactory: () => { throw new Error("private endpoint") } })
    await expect(failed.client.connect()).rejects.toThrow("Indexer request failed (disconnected).")
  })

  it("times out handshake and requests, and permits reconnect", async () => {
    vi.useFakeTimers()
    const { client, sockets } = setup({ timeoutMs: 50 })
    const handshake = expect(client.connect()).rejects.toMatchObject({ code: "timeout" })
    await vi.advanceTimersByTimeAsync(50)
    await handshake
    const request = client.request("server.ping")
    const assertion = expect(request).rejects.toMatchObject({ code: "timeout" })
    sockets[1].open()
    await vi.advanceTimersByTimeAsync(50)
    await assertion
    const next = client.request("server.ping")
    await tick()
    sockets[1].reply(sockets[1].sent.at(-1)!.id, 0)
    expect(await next).toBe(0)
  })

  it("aborts pending/connecting requests, and dispose is terminal", async () => {
    const { client, sockets } = setup()
    const controller = new AbortController()
    const pending = client.request("server.ping", [], controller.signal)
    const aborted = expect(pending).rejects.toMatchObject({ code: "aborted" })
    controller.abort()
    await aborted
    sockets[0].open()
    await tick()
    expect(sockets[0].sent).toEqual([])
    await expect(client.request("server.ping", [], controller.signal)).rejects.toMatchObject({ code: "aborted" })
    const waiting = expect(client.request("server.ping")).rejects.toMatchObject({ code: "disposed" })
    client.dispose()
    await waiting
    await expect(client.connect()).rejects.toMatchObject({ code: "disposed" })
    await expect(client.request("server.ping")).rejects.toMatchObject({ code: "disposed" })
  })

  it("blocks arbitrary methods and broadcast through the read API", async () => {
    const { client, factory } = setup()
    for (const method of ["wallet.create", "blockchain.transaction.broadcast"]) {
      await expect(client.request(method as ElectrumReadMethod, ["00"])).rejects.toMatchObject({ code: "method-not-allowed" })
    }
    await expect(client.broadcastTransaction("00", { userInitiated: true, network: "regtest" })).rejects.toMatchObject({ code: "broadcast-disabled" })
    expect(factory).not.toHaveBeenCalled()
  })

  it("requires explicit regtest opt-in and per-action intent for the separate broadcast method", async () => {
    const { client, sockets, factory } = setup({ enableRegtestBroadcast: true })
    await expect(client.broadcastTransaction("00", { userInitiated: false, network: "regtest" } as never)).rejects.toMatchObject({ code: "broadcast-disabled" })
    await expect(client.broadcastTransaction("00", { userInitiated: true, network: "mainnet" } as never)).rejects.toMatchObject({ code: "broadcast-disabled" })
    expect(factory).not.toHaveBeenCalled()
    const pending = client.broadcastTransaction("00", { userInitiated: true, network: "regtest" })
    sockets[0].open()
    await tick()
    expect(sockets[0].sent[0].method).toBe("blockchain.transaction.broadcast")
    sockets[0].reply(sockets[0].sent[0].id, "ab".repeat(32))
    expect(await pending).toBe("ab".repeat(32))
  })

  it.each(["00", "00".repeat(79), "00".repeat(80), "00".repeat(112), "not-hex", ""])("never verifies consensus from header/banner/features (%s)", async headerHex => {
    const { client, sockets } = setup()
    const pending = client.probeCapabilities()
    sockets[0].open()
    await tick()
    expect(sockets[0].sent.map(item => item.method)).toEqual(["server.version", "server.features", "blockchain.headers.subscribe"])
    for (const item of sockets[0].sent) {
      sockets[0].reply(item.id, item.method === "server.version" ? ["BLAKE2b server", "1.4"] : item.method === "server.features" ? { network: "regtest", genesis_hash: "ab".repeat(32) } : { height: 0, hex: headerHex })
    }
    const result = await pending
    expect(result).toMatchObject({ verification: "needs-consensus-verification", consensusProof: "not-implemented", observedHeight: 0, observedNetwork: "regtest" })
    if (headerHex.length < 160) expect(result.headerObservation).toBe("missing-or-malformed")
    expect(result).not.toHaveProperty("readyForSigning")
    expect(result).not.toHaveProperty("verified")
  })
})
