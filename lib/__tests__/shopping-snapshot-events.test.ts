import { describe, expect, it, vi } from "vitest"
import { loadCompleteShoppingSnapshotEvents } from "@/lib/shopping-snapshot-events"
import type { ShoppingSnapshotEvent } from "@/lib/shopping-view"

function ev(sequence: number): ShoppingSnapshotEvent {
  return {
    id: `e${sequence}`,
    sequence,
    type: "repayment",
    actorMemberId: "m1",
    encryptedPayload: "sg1:0123456789abcdef01234567:abcd",
    keyVersion: 1,
    operationId: `op-${sequence}`,
    createdAt: "2026-09-01T00:00:00.000Z",
  }
}

describe("loadCompleteShoppingSnapshotEvents", () => {
  it("returns the snapshot tail when there is no earlier history", async () => {
    const tail = [ev(1), ev(2)]
    const fetchBefore = vi.fn()
    const merged = await loadCompleteShoppingSnapshotEvents(tail, {
      oldestIncludedSequence: 1,
      hasEarlierEvents: false,
    }, fetchBefore)
    expect(merged).toEqual(tail)
    expect(fetchBefore).not.toHaveBeenCalled()
  })

  it("pages backward until hasMore is false", async () => {
    const tail = [ev(51), ev(52)]
    const fetchBefore = vi
      .fn()
      .mockResolvedValueOnce({ events: [ev(1), ev(50)], hasMore: false })

    const merged = await loadCompleteShoppingSnapshotEvents(
      tail,
      { oldestIncludedSequence: 51, hasEarlierEvents: true },
      fetchBefore,
    )

    expect(fetchBefore).toHaveBeenCalledWith(51)
    expect(merged.map((e) => e.sequence)).toEqual([1, 50, 51, 52])
  })

  it("loops while the events API reports hasMore", async () => {
    const tail = [ev(151), ev(152)]
    const fetchBefore = vi
      .fn()
      .mockResolvedValueOnce({ events: [ev(51), ev(150)], hasMore: true })
      .mockResolvedValueOnce({ events: [ev(1), ev(50)], hasMore: false })

    const merged = await loadCompleteShoppingSnapshotEvents(
      tail,
      { oldestIncludedSequence: 151, hasEarlierEvents: true },
      fetchBefore,
    )

    expect(fetchBefore).toHaveBeenNthCalledWith(1, 151)
    expect(fetchBefore).toHaveBeenNthCalledWith(2, 51)
    expect(merged[0]?.sequence).toBe(1)
    expect(merged.at(-1)?.sequence).toBe(152)
  })
})
