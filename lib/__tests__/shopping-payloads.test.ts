import { describe, expect, it } from "vitest"
import {
  buildGroupMetadata,
  parseGroupMetadata,
  parseRequestPayload,
  ShoppingPayloadError,
} from "../shopping-payloads"
import { SHOPPING_MAX_DESCRIPTION_CHARS } from "../shopping-types"

describe("shopping group metadata", () => {
  it("stores an optional description with the encrypted name payload", () => {
    const built = buildGroupMetadata("Household groceries", "Weekly staples")
    expect(built).toEqual({
      schemaVersion: 1,
      name: "Household groceries",
      description: "Weekly staples",
    })
    expect(parseGroupMetadata({ schemaVersion: 1, name: "Cabin" }).description).toBeUndefined()
  })

  it("omits blank description and rejects overlong copy", () => {
    expect(buildGroupMetadata("Trip", "   ").description).toBeUndefined()
    expect(() =>
      parseGroupMetadata({
        schemaVersion: 1,
        name: "Trip",
        description: "x".repeat(SHOPPING_MAX_DESCRIPTION_CHARS + 1),
      }),
    ).toThrow(ShoppingPayloadError)
  })
})

describe("shopping request payload", () => {
  it("defaults quantity and check-off", () => {
    const parsed = parseRequestPayload({ schemaVersion: 1, description: "Oat milk" })
    expect(parsed.requestedQuantity).toBe(1)
    expect(parsed.checkedOff).toBe(false)
  })
})
