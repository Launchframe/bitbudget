import { describe, expect, it } from "vitest"
import {
  activeTransactionSetupSignature,
  discretionaryAllotmentSignature,
} from "@/lib/setup-guide-client"
import type { Envelope, Transaction } from "@/lib/data"

describe("setup-guide-client", () => {
  it("discretionaryAllotmentSignature ignores savings and archived", () => {
    const envelopes: Envelope[] = [
      { id: "s", name: "Savings", monthlyAllotment: 100, color: "#", systemRole: "savings" },
      { id: "a", name: "Food", monthlyAllotment: 50, color: "#" },
      { id: "b", name: "Old", monthlyAllotment: 10, color: "#", archived: true },
    ]
    expect(discretionaryAllotmentSignature(envelopes)).toBe("a:50")
  })

  it("activeTransactionSetupSignature changes when setup-relevant fields change", () => {
    const base: Transaction = {
      id: "t1",
      envelopeId: "e1",
      date: "2026-05-01",
      payee: "enc",
      amount: 50,
      type: "expense",
      tags: [],
      source: "manual",
    }
    const a = activeTransactionSetupSignature([base])
    const b = activeTransactionSetupSignature([
      { ...base, type: "credit", source: "paycheck" },
    ])
    expect(a).not.toBe(b)
    expect(activeTransactionSetupSignature([base])).toBe(a)
  })
})
