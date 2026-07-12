import { describe, expect, it } from "vitest"
import {
  resolveRelativeDateFromTranscript,
  resolveVoiceTransactionDate,
} from "@/lib/voice-relative-dates"

describe("resolveRelativeDateFromTranscript", () => {
  const today = "2026-07-12"

  it("resolves today", () => {
    expect(resolveRelativeDateFromTranscript("Purchase from Cursor, $25 today", today)).toBe(
      "2026-07-12",
    )
  })

  it("resolves yesterday", () => {
    expect(resolveRelativeDateFromTranscript("coffee yesterday five dollars", today)).toBe(
      "2026-07-11",
    )
  })

  it("resolves tomorrow", () => {
    expect(resolveRelativeDateFromTranscript("pay rent tomorrow", today)).toBe("2026-07-13")
  })

  it("resolves N days ago", () => {
    expect(resolveRelativeDateFromTranscript("gas 40 dollars 3 days ago", today)).toBe(
      "2026-07-09",
    )
    expect(resolveRelativeDateFromTranscript("lunch 1 day ago", today)).toBe("2026-07-11")
  })

  it("returns null when no relative phrase", () => {
    expect(resolveRelativeDateFromTranscript("coffee at starbucks five dollars", today)).toBeNull()
  })
})

describe("resolveVoiceTransactionDate", () => {
  it("prefers transcript relative date over hallucinated model date", () => {
    expect(
      resolveVoiceTransactionDate({
        transcript: "Purchase from Cursor, $25 today",
        clientToday: "2026-07-12",
        modelDate: "2023-10-05",
      }),
    ).toBe("2026-07-12")
  })

  it("uses model date when transcript has no relative phrase", () => {
    expect(
      resolveVoiceTransactionDate({
        transcript: "coffee five dollars",
        clientToday: "2026-07-12",
        modelDate: "2026-06-01",
      }),
    ).toBe("2026-06-01")
  })

  it("falls back to client today when model date missing", () => {
    expect(
      resolveVoiceTransactionDate({
        transcript: "coffee five dollars",
        clientToday: "2026-07-12",
        modelDate: null,
      }),
    ).toBe("2026-07-12")
  })
})
