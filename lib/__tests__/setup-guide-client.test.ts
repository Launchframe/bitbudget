import { describe, expect, it } from "vitest"
import { discretionaryAllotmentSignature } from "@/lib/setup-guide-client"
import type { Envelope } from "@/lib/data"

describe("setup-guide-client", () => {
  it("discretionaryAllotmentSignature ignores savings and archived", () => {
    const envelopes: Envelope[] = [
      { id: "s", name: "Savings", monthlyAllotment: 100, color: "#", systemRole: "savings" },
      { id: "a", name: "Food", monthlyAllotment: 50, color: "#" },
      { id: "b", name: "Old", monthlyAllotment: 10, color: "#", archived: true },
    ]
    expect(discretionaryAllotmentSignature(envelopes)).toBe("a:50")
  })
})
