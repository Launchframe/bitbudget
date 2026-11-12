import { describe, expect, it } from "vitest"
import { findTransactionHistoryStart } from "../income-import-tx0"

describe("income-import-tx0", () => {
  it("findTransactionHistoryStart ignores import and funding legs", () => {
    const tx0 = findTransactionHistoryStart([
      { date: "2023-01-15", type: "credit", source: "income_import" },
      { date: "2022-06-01", type: "credit", source: "manual" },
      { date: "2022-05-01", type: "credit", source: "envelope_funding_in", excludeFromMainHistory: true },
    ])
    expect(tx0).toEqual({ year: 2022, month: 6, periodKey: "2022-06", dateIso: "2022-06-01" })
  })

  it("returns null when only synthetic credits exist", () => {
    expect(
      findTransactionHistoryStart([
        { date: "2023-01-15", type: "credit", source: "income_import" },
      ]),
    ).toBeNull()
  })
})
