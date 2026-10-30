import { describe, expect, it, vi } from "vitest"
import {
  ShoppingSnapshotHistoryError,
  loadCompleteShoppingSnapshotEvents,
} from "@/lib/shopping-snapshot-events"
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

  it("walks from the oldest sequence when a page is not sorted", async () => {
    const tail = [ev(152), ev(151)]
    const fetchBefore = vi
      .fn()
      .mockResolvedValueOnce({ events: [ev(150), ev(51)], hasMore: true })
      .mockResolvedValueOnce({ events: [ev(50), ev(1)], hasMore: false })

    const merged = await loadCompleteShoppingSnapshotEvents(
      tail,
      { oldestIncludedSequence: 151, hasEarlierEvents: true },
      fetchBefore,
    )

    expect(fetchBefore).toHaveBeenNthCalledWith(1, 151)
    expect(fetchBefore).toHaveBeenNthCalledWith(2, 51)
    expect(merged.map((e) => e.sequence)).toEqual([1, 50, 51, 150, 151, 152])
  })

  it("drops a repeated sequence instead of applying it twice", async () => {
    const tail = [ev(51)]
    const fetchBefore = vi.fn().mockResolvedValueOnce({
      events: [ev(50), ev(50)],
      hasMore: false,
    })

    const merged = await loadCompleteShoppingSnapshotEvents(
      tail,
      { oldestIncludedSequence: 51, hasEarlierEvents: true },
      fetchBefore,
    )

    expect(merged.map((e) => e.sequence)).toEqual([50, 51])
  })

  it("fails closed when a later event in the page is not strictly older", async () => {
    const fetchBefore = vi.fn().mockResolvedValue({
      events: [ev(50), ev(151)],
      hasMore: true,
    })
    await expect(
      loadCompleteShoppingSnapshotEvents(
        [ev(151)],
        { oldestIncludedSequence: 151, hasEarlierEvents: true },
        fetchBefore,
      ),
    ).rejects.toBeInstanceOf(ShoppingSnapshotHistoryError)
    expect(fetchBefore).toHaveBeenCalledTimes(1)
  })

  it("fails closed when hasMore stays true but the cursor does not move backward", async () => {
    const fetchBefore = vi.fn().mockResolvedValue({
      events: [ev(151), ev(152)],
      hasMore: true,
    })

    await expect(
      loadCompleteShoppingSnapshotEvents(
        [ev(151)],
        { oldestIncludedSequence: 151, hasEarlierEvents: true },
        fetchBefore,
      ),
    ).rejects.toBeInstanceOf(ShoppingSnapshotHistoryError)
    expect(fetchBefore).toHaveBeenCalledTimes(1)
  })

  it("fails closed when an empty page still reports hasMore", async () => {
    const fetchBefore = vi.fn().mockResolvedValue({ events: [], hasMore: true })

    await expect(
      loadCompleteShoppingSnapshotEvents(
        [ev(51)],
        { oldestIncludedSequence: 51, hasEarlierEvents: true },
        fetchBefore,
      ),
    ).rejects.toBeInstanceOf(ShoppingSnapshotHistoryError)
    expect(fetchBefore).toHaveBeenCalledTimes(1)
  })

  it("fails closed when hasMore is missing", async () => {
    const fetchBefore = vi.fn().mockResolvedValue({ events: [ev(1)] })

    await expect(
      loadCompleteShoppingSnapshotEvents(
        [ev(51)],
        { oldestIncludedSequence: 51, hasEarlierEvents: true },
        fetchBefore,
      ),
    ).rejects.toBeInstanceOf(ShoppingSnapshotHistoryError)
  })

  it("uses the oldest tail event when the snapshot does not name a cursor", async () => {
    const fetchBefore = vi.fn().mockResolvedValue({ events: [ev(1)], hasMore: false })
    const merged = await loadCompleteShoppingSnapshotEvents(
      [ev(52), ev(51)],
      { oldestIncludedSequence: null, hasEarlierEvents: true },
      fetchBefore,
    )
    expect(fetchBefore).toHaveBeenCalledWith(51)
    expect(merged.map((event) => event.sequence)).toEqual([1, 51, 52])
  })

  it("fails closed on a sequence that is not a whole number", async () => {
    const fetchBefore = vi.fn()
    const meta = { oldestIncludedSequence: null, hasEarlierEvents: false as const }
    await expect(
      loadCompleteShoppingSnapshotEvents([{ ...ev(1), sequence: 1.5 }], meta, fetchBefore),
    ).rejects.toBeInstanceOf(ShoppingSnapshotHistoryError)
    await expect(
      loadCompleteShoppingSnapshotEvents([{ ...ev(1), sequence: -1 }], meta, fetchBefore),
    ).rejects.toBeInstanceOf(ShoppingSnapshotHistoryError)
    expect(fetchBefore).not.toHaveBeenCalled()
  })

  it("fails closed when a history page is missing", async () => {
    const fetchBefore = vi.fn().mockResolvedValue(null)
    await expect(
      loadCompleteShoppingSnapshotEvents(
        [ev(2)],
        { oldestIncludedSequence: 2, hasEarlierEvents: true },
        fetchBefore,
      ),
    ).rejects.toBeInstanceOf(ShoppingSnapshotHistoryError)
  })

  it("fails closed when the snapshot events are not a list", async () => {
    const fetchBefore = vi.fn()
    await expect(
      loadCompleteShoppingSnapshotEvents(
        undefined as unknown as ShoppingSnapshotEvent[],
        { oldestIncludedSequence: null, hasEarlierEvents: false },
        fetchBefore,
      ),
    ).rejects.toBeInstanceOf(ShoppingSnapshotHistoryError)
    expect(fetchBefore).not.toHaveBeenCalled()
  })

  it("fails closed when earlier history is claimed but there is no cursor", async () => {
    const fetchBefore = vi.fn()
    await expect(
      loadCompleteShoppingSnapshotEvents([], { oldestIncludedSequence: null, hasEarlierEvents: true }, fetchBefore),
    ).rejects.toBeInstanceOf(ShoppingSnapshotHistoryError)
    expect(fetchBefore).not.toHaveBeenCalled()
  })
})
