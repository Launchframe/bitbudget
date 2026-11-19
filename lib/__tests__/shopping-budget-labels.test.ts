import { describe, expect, it } from "vitest"
import { shoppingEntryLabel, shoppingEntryPayee } from "../shopping-budget-projection"

describe("shopping entry labels", () => {
  it("uses plain names for each kind", () => {
    expect(shoppingEntryLabel("own_expense")).toBe("Your share")
    expect(shoppingEntryLabel("advance_out")).toBe("You covered someone else")
    expect(shoppingEntryLabel("repayment_expense")).toBe("You paid them back")
  })

  it("uses the store name from a receipt", () => {
    expect(
      shoppingEntryPayee({ eventType: "receipt_finalized", merchant: "  Market  " }),
    ).toBe("Market")
    expect(shoppingEntryPayee({ eventType: "receipt_finalized", merchant: " " })).toBe(
      "Shared purchase",
    )
  })

  it("uses a generic name for a repayment", () => {
    expect(shoppingEntryPayee({ eventType: "repayment" })).toBe("Shared repayment")
    expect(shoppingEntryPayee({})).toBe("Shared shopping")
  })
})
