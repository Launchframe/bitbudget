import { afterEach, describe, expect, it, vi } from "vitest"

import { EsploraClient } from "@/lib/wallet/chain/esplora-client"

const address = "bcrt1q" + "a".repeat(38)
const txid = (i: number) => i.toString(16).padStart(64, "0")
const status = { confirmed: true, block_height: 0, block_hash: txid(10), block_time: 0 }
const tx = (i: number) => ({ txid: txid(i), fee: 0, status })
const response = (data: unknown) => new Response(JSON.stringify(data), { headers: { "content-type": "application/json" } })
const clients: EsploraClient[] = []
function setup(fetchImpl: typeof fetch, options: Partial<ConstructorParameters<typeof EsploraClient>[0]> = {}) {
  const client = new EsploraClient({ baseUrl: "https://explorer.example/api/", fetchImpl, ...options })
  clients.push(client)
  return client
}
afterEach(() => { clients.splice(0).forEach(client => client.dispose()); vi.useRealTimers() })

describe("Esplora browser read transport", () => {
  it("uses only the configured API base and privacy-preserving fetch options", async () => {
    const fetchImpl = vi.fn(async () => new Response("0"))
    const client = setup(fetchImpl, { baseUrl: "https://explorer.example/custom/api" })
    expect(await client.getTipHeight()).toBe(0)
    expect(fetchImpl).toHaveBeenCalledWith("https://explorer.example/custom/api/blocks/tip/height", expect.objectContaining({ method: "GET", redirect: "error", credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store", mode: "cors", signal: expect.any(AbortSignal) }))
  })

  it("never uses server fetch without a test injection", async () => {
    const client = new EsploraClient({ baseUrl: "https://explorer.example" })
    await expect(client.getTipHeight()).rejects.toMatchObject({ code: "browser-only" })
    client.dispose()
  })

  it("rejects unsupported URLs and address/path injection before any request", async () => {
    const fetchImpl = vi.fn()
    expect(() => setup(fetchImpl, { baseUrl: "wss://explorer.example" })).toThrow("unsupported-transport")
    expect(() => setup(fetchImpl, { baseUrl: "https://user:secret@explorer.example" })).toThrow()
    const client = setup(fetchImpl)
    for (const input of ["//169.254.169.254", "../secrets", "https://evil.example", "a?token=secret", "%2fprivate"]) {
      await expect(client.getAddressUtxos(input)).rejects.toMatchObject({ code: "invalid-input" })
      await expect(client.getTransactionStatus(input)).rejects.toMatchObject({ code: "invalid-input" })
    }
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it.each(["https://other.example/api/blocks/tip/height", "https://explorer.example/other/path"])("rejects redirected or escaped responses to %s", async url => {
    const result = new Response("0")
    Object.defineProperty(result, "url", { value: url })
    const client = setup(vi.fn(async () => result))
    await expect(client.getTipHeight()).rejects.toMatchObject({ code: "redirect" })
  })

  it("rejects redirects even if they return to the same URL", async () => {
    const result = new Response("0")
    Object.defineProperty(result, "redirected", { value: true })
    const client = setup(vi.fn(async () => result))
    await expect(client.getTipHeight()).rejects.toMatchObject({ code: "redirect" })
  })

  it("never leaks raw HTTP error bodies or network exception messages", async () => {
    const client = setup(vi.fn(async () => new Response("secret address and private node trace", { status: 500 })))
    await expect(client.getTipHeight()).rejects.toThrow("Explorer request failed (http).")
    const failed = setup(vi.fn(async () => { throw new Error("private URL") }))
    await expect(failed.getTipHeight()).rejects.toThrow("Explorer request failed (network).")
  })

  it.each(["", "-1", "1.5", "1e3", "9007199254740992", "private error"])("rejects invalid heights %s", async value => {
    const client = setup(vi.fn(async () => new Response(value)))
    await expect(client.getTipHeight()).rejects.toMatchObject({ code: "invalid-response" })
  })

  it("keeps empty UTXOs, zero address stats, and empty or zero fee maps distinct from failure", async () => {
    const stats = { funded_txo_count: 0, funded_txo_sum: 0, spent_txo_count: 0, spent_txo_sum: 0, tx_count: 0 }
    const fetchImpl = vi.fn().mockResolvedValueOnce(response([])).mockResolvedValueOnce(response({ address, chain_stats: stats, mempool_stats: stats })).mockResolvedValueOnce(response({})).mockResolvedValueOnce(response({ "1": 0 }))
    const client = setup(fetchImpl)
    expect(await client.getAddressUtxos(address)).toEqual({ items: [], complete: true, completeness: "server-reported", consensusVerified: false, snapshotConsistent: false })
    expect((await client.getAddressInfo(address)).chain_stats.tx_count).toBe(0)
    expect(await client.getFeeEstimates()).toEqual({})
    expect(await client.getFeeEstimates()).toEqual({ "1": 0 })
  })

  it("validates UTXO fields and confirmed status instead of trusting response casts", async () => {
    const valid = { txid: txid(1), vout: 0, value: 0, status }
    const client = setup(vi.fn(async () => response([valid])))
    expect((await client.getAddressUtxos(address)).items).toEqual([valid])
    for (const entry of [{ ...valid, value: -1 }, { ...valid, value: Number.MAX_SAFE_INTEGER + 1 }, { ...valid, vout: 0x100000000 }, { ...valid, txid: "bad" }, { ...valid, status: { confirmed: true } }, { ...valid, status: { ...status, confirmed: false } }]) {
      const malformed = setup(vi.fn(async () => response([entry])))
      await expect(malformed.getAddressUtxos(address)).rejects.toMatchObject({ code: "invalid-response" })
    }
    const duplicate = setup(vi.fn(async () => response([valid, valid])))
    await expect(duplicate.getAddressUtxos(address)).rejects.toMatchObject({ code: "invalid-response" })
  })

  it("supports explicit transaction status and validates returned transaction identity", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(response({ confirmed: false })).mockResolvedValueOnce(response(status)).mockResolvedValueOnce(response(tx(2))).mockResolvedValueOnce(new Response("aabb"))
    const client = setup(fetchImpl)
    expect(await client.getTransactionStatus(txid(1))).toEqual({ confirmed: false })
    expect(await client.getTransactionStatus(txid(1))).toEqual(status)
    await expect(client.getTransaction(txid(1))).rejects.toMatchObject({ code: "invalid-response" })
    expect(await client.getTransactionHex(txid(1))).toBe("aabb")
  })

  it("paginates confirmed history independently of mempool and exposes server-reported completeness", async () => {
    const first = Array.from({ length: 25 }, (_, i) => tx(i + 1))
    const mempool = { ...tx(100), status: { confirmed: false } }
    const fetchImpl = vi.fn().mockResolvedValueOnce(response([mempool])).mockResolvedValueOnce(response(first)).mockResolvedValueOnce(response([tx(26)]))
    const client = setup(fetchImpl)
    const result = await client.getAddressTxs(address)
    expect(result.items).toHaveLength(27)
    expect(result).toMatchObject({ complete: true, completeness: "server-reported", snapshotConsistent: false, consensusVerified: false })
    expect(fetchImpl.mock.calls.map(call => call[0])).toEqual([
      `https://explorer.example/api/address/${address}/txs/mempool`,
      `https://explorer.example/api/address/${address}/txs/chain`,
      `https://explorer.example/api/address/${address}/txs/chain/${txid(25)}`,
    ])
  })

  it("does not call a capped page or capped mempool complete", async () => {
    const first = Array.from({ length: 25 }, (_, i) => tx(i + 1))
    const client = setup(vi.fn().mockResolvedValueOnce(response([])).mockResolvedValueOnce(response(first)))
    expect(await client.getAddressTxs(address, { maxPages: 1 })).toMatchObject({ complete: false, completeness: "page-limit" })
    const mempool = Array.from({ length: 50 }, (_, i) => ({ ...tx(i + 1), status: { confirmed: false } }))
    const capped = setup(vi.fn().mockResolvedValueOnce(response(mempool)).mockResolvedValueOnce(response([])))
    expect(await capped.getAddressTxs(address)).toMatchObject({ complete: false, completeness: "mempool-limit" })
  })

  it("reports repeated cursors and mempool/chain races as incomplete, not duplicate money", async () => {
    const first = Array.from({ length: 25 }, (_, i) => tx(i + 1))
    const client = setup(vi.fn().mockResolvedValueOnce(response([])).mockResolvedValueOnce(response(first)).mockResolvedValueOnce(response(first)))
    expect(await client.getAddressTxs(address)).toMatchObject({ complete: false, completeness: "inconsistent-pagination", items: first })
    const racing = setup(vi.fn().mockResolvedValueOnce(response([{ ...tx(1), status: { confirmed: false } }])).mockResolvedValueOnce(response([tx(1)])))
    expect(await racing.getAddressTxs(address)).toMatchObject({ complete: false, completeness: "inconsistent-pagination" })
  })

  it("rejects a failed later page rather than returning a complete partial history", async () => {
    const first = Array.from({ length: 25 }, (_, i) => tx(i + 1))
    const client = setup(vi.fn().mockResolvedValueOnce(response([])).mockResolvedValueOnce(response(first)).mockResolvedValueOnce(new Response("private error", { status: 503 })))
    await expect(client.getAddressTxs(address)).rejects.toMatchObject({ code: "http", status: 503 })
  })

  it("bounds response bytes and rejects malformed JSON", async () => {
    const client = setup(vi.fn(async () => new Response("0".repeat(33))), { maxResponseBytes: 32 })
    await expect(client.getTipHeight()).rejects.toMatchObject({ code: "limit" })
    const headerLimit = setup(vi.fn(async () => new Response("0", { headers: { "content-length": "99999999" } })))
    await expect(headerLimit.getTipHeight()).rejects.toMatchObject({ code: "limit" })
    const malformed = setup(vi.fn(async () => new Response("private broken JSON")))
    await expect(malformed.getFeeEstimates()).rejects.toMatchObject({ code: "invalid-response" })
  })

  it("times out even an injected fetch that ignores abort", async () => {
    vi.useFakeTimers()
    const fetchImpl = vi.fn(() => new Promise<Response>(() => {}))
    const client = setup(fetchImpl, { timeoutMs: 25 })
    const assertion = expect(client.getTipHeight()).rejects.toMatchObject({ code: "timeout" })
    await vi.advanceTimersByTimeAsync(25)
    await assertion
    expect(fetchImpl.mock.calls).toHaveLength(1)
  })

  it("cancels a stalled response body on timeout", async () => {
    vi.useFakeTimers()
    const cancel = vi.fn()
    const body = new ReadableStream<Uint8Array>({ cancel })
    const client = setup(vi.fn(async () => new Response(body)), { timeoutMs: 25 })
    const assertion = expect(client.getTipHeight()).rejects.toMatchObject({ code: "timeout" })
    await vi.advanceTimersByTimeAsync(25)
    await assertion
    expect(cancel).toHaveBeenCalledOnce()
  })

  it("supports cancellation and terminal disposal without logging raw abort reasons", async () => {
    const fetchImpl = vi.fn(() => new Promise<Response>(() => {}))
    const client = setup(fetchImpl)
    const controller = new AbortController()
    const assertion = expect(client.getTipHeight(controller.signal)).rejects.toMatchObject({ code: "aborted" })
    controller.abort("private user reason")
    await assertion
    await expect(client.getTipHeight(controller.signal)).rejects.toMatchObject({ code: "aborted" })
    const disposed = expect(client.getTipHeight()).rejects.toMatchObject({ code: "disposed" })
    client.dispose()
    await disposed
    await expect(client.getTipHeight()).rejects.toMatchObject({ code: "disposed" })
  })
})
