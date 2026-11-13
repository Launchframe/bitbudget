import { describe, expect, it } from "vitest"
import {
  MARKETING_ENCRYPTED_PAYEES_NOTES,
  MARKETING_VARIANT_CONFIG,
} from "@/lib/marketing-pitch-copy"

describe("marketing pitch copy", () => {
  it("uses the same encryption card on both public pitches", () => {
    for (const variant of ["btc", "vanilla"] as const) {
      expect(MARKETING_VARIANT_CONFIG[variant].onboardingSource).toBeDefined()
    }
    expect(MARKETING_ENCRYPTED_PAYEES_NOTES.title).toBe("Encrypted payees & notes")
    expect(MARKETING_ENCRYPTED_PAYEES_NOTES.body).toContain(
      "Who you transact with is your business",
    )
  })
})
