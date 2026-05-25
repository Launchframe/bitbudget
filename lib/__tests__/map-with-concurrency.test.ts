import { describe, expect, it } from "vitest"
import { mapWithConcurrency } from "../map-with-concurrency"

describe("mapWithConcurrency", () => {
  it("preserves order and limits parallel execution", async () => {
    let inFlight = 0
    let maxInFlight = 0
    const items = [1, 2, 3, 4, 5, 6]

    const results = await mapWithConcurrency(items, 2, async (n) => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((r) => setTimeout(r, 5))
      inFlight--
      return n * 2
    })

    expect(results).toEqual([2, 4, 6, 8, 10, 12])
    expect(maxInFlight).toBeLessThanOrEqual(2)
  })
})
