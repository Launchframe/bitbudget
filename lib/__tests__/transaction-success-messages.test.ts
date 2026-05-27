import { describe, expect, it } from "vitest"
import { pickTransactionSuccessMessage } from "@/lib/transaction-success-messages"

describe("pickTransactionSuccessMessage", () => {
  it("returns expense messages for expenses", () => {
    const msg = pickTransactionSuccessMessage("expense")
    expect(msg.length).toBeGreaterThan(10)
  })

  it("returns credit messages for credits", () => {
    const msg = pickTransactionSuccessMessage("credit")
    expect(msg.length).toBeGreaterThan(10)
  })

  it("returns recurring messages when isRecurring is true", () => {
    const msg = pickTransactionSuccessMessage("expense", { isRecurring: true })
    expect(msg.toLowerCase()).toMatch(/recurring|forget|automation|future/)
  })
})
