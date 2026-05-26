import { describe, expect, it } from "vitest"
import { SYSTEM_ENVELOPE_ROLE_SAVINGS } from "@/lib/constants"
import type { Envelope, Transaction } from "@/lib/data"
import {
  formatSavingsSinceLabel,
  resolveSavingsTrackingStart,
  resolveSavingsTrackingStartFromTransactions,
  savingsBalanceSince,
} from "../savings-display"

const savingsEnvelope: Envelope = {
  id: "sav-1",
  name: "Savings",
  monthlyAllotment: 0,
  color: "#D4AF37",
  systemRole: SYSTEM_ENVELOPE_ROLE_SAVINGS,
}

describe("savings-display", () => {
  it("resolveSavingsTrackingStart prefers tx0 over onboarding and signup", () => {
    expect(
      resolveSavingsTrackingStart({
        tx0Date: "2024-06-15",
        onboardingCompletedAt: "2024-05-01T12:00:00.000Z",
        accountCreatedAt: "2024-04-01T12:00:00.000Z",
      }),
    ).toBe("2024-06-15")
    expect(
      resolveSavingsTrackingStart({
        tx0Date: null,
        onboardingCompletedAt: "2024-05-01T12:00:00.000Z",
        accountCreatedAt: "2024-04-01T12:00:00.000Z",
      }),
    ).toBe("2024-05-01")
  })

  it("resolveSavingsTrackingStartFromTransactions uses earliest real credit", () => {
    const start = resolveSavingsTrackingStartFromTransactions(
      [
        {
          id: "1",
          date: "2023-01-15",
          payee: "Import",
          amount: 5000,
          type: "credit",
          envelopeId: "sav-1",
          tags: [],
          source: "income_import",
        },
        {
          id: "2",
          date: "2024-06-20",
          payee: "Paycheck",
          amount: 2000,
          type: "credit",
          envelopeId: "sav-1",
          tags: [],
          source: "paycheck",
        },
      ],
      "2024-05-01T12:00:00.000Z",
      "2024-04-01T12:00:00.000Z",
    )
    expect(start).toBe("2024-06-20")
  })

  it("savingsBalanceSince excludes pre-tracking credits", () => {
    const txns: Transaction[] = [
      {
        id: "1",
        date: "2023-06-01",
        payee: "Import",
        amount: 10000,
        type: "credit",
        envelopeId: "sav-1",
        tags: [],
        source: "income_import",
      },
      {
        id: "2",
        date: "2024-06-20",
        payee: "Paycheck",
        amount: 2000,
        type: "credit",
        envelopeId: "sav-1",
        tags: [],
        source: "paycheck",
      },
    ]
    expect(savingsBalanceSince(txns, savingsEnvelope, "2024-06-20")).toBe(2000)
  })

  it("formatSavingsSinceLabel renders a readable date", () => {
    expect(formatSavingsSinceLabel("2024-06-20")).toMatch(/Jun/)
  })
})
