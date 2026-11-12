import { describe, expect, it } from "vitest"
import {
  canRestoreSoftDeletedEnvelope,
  daysUntilEnvelopePurge,
  envelopeDeletePurgeCutoff,
  isEnvelopeSoftDeleted,
} from "../envelope-delete"

describe("envelope-delete", () => {
  it("detects soft-deleted envelopes", () => {
    expect(isEnvelopeSoftDeleted({ deletedAt: "2026-01-01T00:00:00.000Z" })).toBe(true)
    expect(isEnvelopeSoftDeleted({ deletedAt: null })).toBe(false)
    expect(isEnvelopeSoftDeleted({})).toBe(false)
  })

  it("allows restore within grace window", () => {
    const now = Date.parse("2026-05-31T12:00:00.000Z")
    expect(
      canRestoreSoftDeletedEnvelope({ deletedAt: "2026-05-02T12:00:00.000Z" }, now),
    ).toBe(true)
    expect(
      canRestoreSoftDeletedEnvelope({ deletedAt: "2026-04-01T12:00:00.000Z" }, now),
    ).toBe(false)
  })

  it("computes days until purge", () => {
    const now = Date.parse("2026-05-31T12:00:00.000Z")
    expect(daysUntilEnvelopePurge({ deletedAt: "2026-05-02T12:00:00.000Z" }, now)).toBe(1)
  })

  it("purge cutoff is 30 days ago", () => {
    const now = new Date("2026-05-31T12:00:00.000Z")
    expect(envelopeDeletePurgeCutoff(now).toISOString()).toBe("2026-05-01T12:00:00.000Z")
  })
})
