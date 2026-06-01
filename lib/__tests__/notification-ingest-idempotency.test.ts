import { describe, expect, it } from "vitest"
import {
  NOTIFICATION_INGEST_IDEMPOTENCY_MAX_LEN,
  normalizeIdempotencyKey,
} from "@/lib/notification-ingest-idempotency"

describe("normalizeIdempotencyKey", () => {
  it("trims and returns null for empty", () => {
    expect(normalizeIdempotencyKey("  ")).toBeNull()
  })

  it("truncates long keys", () => {
    const long = "a".repeat(200)
    expect(normalizeIdempotencyKey(long)?.length).toBe(
      NOTIFICATION_INGEST_IDEMPOTENCY_MAX_LEN,
    )
  })
})
