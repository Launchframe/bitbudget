import { describe, expect, it } from "vitest"
import { transactionSyncUserMessage } from "../transaction-sync-user-message"

describe("transactionSyncUserMessage", () => {
  it("maps network-ish errors", () => {
    expect(transactionSyncUserMessage(new Error("Failed to fetch"))).toMatch(/connection/i)
  })

  it("maps auth-ish errors", () => {
    expect(transactionSyncUserMessage(new Error("Unauthorized"))).toMatch(/session/i)
  })

  it("falls back for unknown errors", () => {
    expect(transactionSyncUserMessage(new Error("Prisma P2002"))).toMatch(/Try again/i)
    expect(transactionSyncUserMessage("weird")).toMatch(/Try again/i)
  })
})
