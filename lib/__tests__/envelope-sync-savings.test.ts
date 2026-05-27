import { describe, expect, it } from "vitest"
import { SYSTEM_ENVELOPE_ROLE_SAVINGS } from "@/lib/constants"
import {
  hasUnresolvedSavingsDraft,
  resolveSavingsDraftIds,
  type SyncEnvelopeDraft,
} from "../envelope-sync-savings"

describe("envelope-sync-savings", () => {
  it("maps id-less Savings draft to system Savings envelope", () => {
    const drafts = [{ name: "Savings" }, { name: "Groceries", id: "g1" }]
    resolveSavingsDraftIds(drafts, [
      { id: "sav-1", name: "Savings", systemRole: SYSTEM_ENVELOPE_ROLE_SAVINGS },
      { id: "g1", name: "Groceries", systemRole: null },
    ])
    expect(drafts[0]?.id).toBe("sav-1")
  })

  it("maps id-less Savings draft to legacy same-named row when system role missing", () => {
    const drafts: SyncEnvelopeDraft[] = [{ name: "savings" }]
    resolveSavingsDraftIds(drafts, [{ id: "legacy-1", name: "Savings", systemRole: null }])
    expect(drafts[0]?.id).toBe("legacy-1")
  })

  it("hasUnresolvedSavingsDraft when Savings has no id and no server match", () => {
    expect(hasUnresolvedSavingsDraft([{ name: "Savings" }])).toBe(true)
    expect(hasUnresolvedSavingsDraft([{ name: "Savings", id: "sav-1" }])).toBe(false)
  })
})
