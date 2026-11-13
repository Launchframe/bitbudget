import { describe, expect, it } from "vitest"
import { buildShoppingTabCsv } from "../shopping-export"

describe("shopping export", () => {
  it("escapes formulas and includes pairwise nets", () => {
    const csv = buildShoppingTabCsv({
      groupName: "=Hijack",
      generatedOn: "2026-09-09",
      aliasesByMemberId: new Map([
        ["a", "Alex"],
        ["b", "Blair"],
      ]),
      balances: [{ memberA: "a", memberB: "b", netCents: 6000, prepaidA: 0, prepaidB: 1000 }],
    })
    expect(csv).toContain("'=Hijack")
    expect(csv).toContain("Alex")
    expect(csv).toContain("60.00")
    expect(csv).toContain("10.00")
  })
})
