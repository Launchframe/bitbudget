import { describe, expect, it, vi } from "vitest"
import { requestBulkDeleteTransactions } from "@/lib/bulk-delete-client"

const jsonResponse = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    ...init,
  })

describe("requestBulkDeleteTransactions", () => {
  it("returns 0 without calling fetch when no ids are provided", async () => {
    const fetcher = vi.fn()

    await expect(requestBulkDeleteTransactions([], fetcher)).resolves.toBe(0)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it("deduplicates ids and returns the deleted count", async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({ deleted: 2 }))

    await expect(requestBulkDeleteTransactions(["tx1", "tx1", "tx2"], fetcher)).resolves.toBe(2)

    expect(fetcher).toHaveBeenCalledWith(
      "/api/transactions/bulk-delete",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ ids: ["tx1", "tx2"] }),
      }),
    )
  })

  it("defaults to 0 when the success response has no numeric deleted count", async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({ deleted: "2" }))

    await expect(requestBulkDeleteTransactions(["tx1"], fetcher)).resolves.toBe(0)
  })

  it("defaults to 0 for a negative deleted count (server never returns negative, but guard it)", async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({ deleted: -1 }))

    await expect(requestBulkDeleteTransactions(["tx1"], fetcher)).resolves.toBe(0)
  })

  it("floors a non-integer deleted count", async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({ deleted: 2.9 }))

    await expect(requestBulkDeleteTransactions(["tx1"], fetcher)).resolves.toBe(2)
  })

  it("throws the API error message for failed responses", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      jsonResponse({ error: "Some ids cannot be bulk-deleted" }, { status: 400 }),
    )

    await expect(requestBulkDeleteTransactions(["tx1"], fetcher)).rejects.toThrow(
      "Some ids cannot be bulk-deleted",
    )
  })

  it("throws the default message when the error body is malformed", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("not-json", { status: 500 }))

    await expect(requestBulkDeleteTransactions(["tx1"], fetcher)).rejects.toThrow(
      "Bulk delete failed",
    )
  })

  it("propagates network failures", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("network down"))

    await expect(requestBulkDeleteTransactions(["tx1"], fetcher)).rejects.toThrow("network down")
  })
})
