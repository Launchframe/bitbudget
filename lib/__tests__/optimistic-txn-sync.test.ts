// @vitest-environment node
import { describe, expect, it } from "vitest"
import {
  applyServerTransactionAfterOptimisticCreate,
  generateId,
  isClientOptimisticId,
  transactionsAfterFullServerSync,
} from "@/lib/data"

describe("optimistic transaction sync", () => {
  it("recognizes client generateId ids and not server cuids", () => {
    const optimistic = generateId()
    expect(isClientOptimisticId(optimistic)).toBe(true)
    expect(isClientOptimisticId("clh3abc123def456ghi789012")).toBe(false)
  })

  it("full server sync keeps in-flight optimistic rows not yet in server id set", () => {
    const serverIds = new Set(["srv_a", "srv_b"])
    const optimistic = { id: generateId(), amount: 10 }
    const rows = [
      { id: "srv_a" },
      { id: "srv_b" },
      optimistic,
      { id: "orphan_local_only" },
    ]
    const kept = transactionsAfterFullServerSync(rows, serverIds)
    expect(kept.map((r) => r.id)).toEqual(["srv_a", "srv_b", optimistic.id])
  })

  it("drops stale non-server rows on full sync", () => {
    const kept = transactionsAfterFullServerSync(
      [{ id: "stale_local" }, { id: generateId() }],
      new Set(["srv_only"]),
    )
    expect(kept.map((r) => r.id)).toHaveLength(1)
    expect(isClientOptimisticId(kept[0]!.id)).toBe(true)
  })

  it("applyServerTransactionAfterOptimisticCreate replaces optimistic row", () => {
    const optimisticId = generateId()
    const serverId = "clh3abc123def456ghi789012"
    const rows = [{ id: optimisticId, amount: 5 }]
    const next = applyServerTransactionAfterOptimisticCreate(rows, optimisticId, {
      id: serverId,
      amount: 5,
    })
    expect(next).toEqual([{ id: serverId, amount: 5 }])
  })

  it("applyServerTransactionAfterOptimisticCreate appends when optimistic was dropped", () => {
    const serverId = "clh3abc123def456ghi789012"
    const next = applyServerTransactionAfterOptimisticCreate(
      [{ id: "other" }],
      generateId(),
      { id: serverId, amount: 1 },
    )
    expect(next.map((r) => r.id)).toEqual([serverId, "other"])
  })

  it("dedupes when refresh merged server row before optimistic replace", () => {
    const optimisticId = generateId()
    const serverId = "clh3abc123def456ghi789012"
    const rows = [
      { id: serverId, amount: 10 },
      { id: optimisticId, amount: 10 },
    ]
    const next = applyServerTransactionAfterOptimisticCreate(rows, optimisticId, {
      id: serverId,
      amount: 10,
    })
    expect(next).toEqual([{ id: serverId, amount: 10 }])
  })

  it("no-op append when server row already present and optimistic missing", () => {
    const serverId = "clh3abc123def456ghi789012"
    const rows = [{ id: serverId, amount: 3 }]
    const next = applyServerTransactionAfterOptimisticCreate(rows, generateId(), {
      id: serverId,
      amount: 99,
    })
    expect(next).toEqual(rows)
  })
})
