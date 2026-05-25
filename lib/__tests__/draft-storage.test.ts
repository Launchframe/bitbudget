// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { clearDraft, loadDraft, saveDraft, saveDraftImmediate } from "../draft-storage"

describe("draft-storage", () => {
  afterEach(() => {
    sessionStorage.clear()
    vi.useRealTimers()
  })

  it("round-trips save/load with validator", () => {
    const key = "bitbudget-test-draft"
    const validate = (v: unknown): v is { step: string } =>
      typeof v === "object" && v != null && typeof (v as { step?: string }).step === "string"

    saveDraftImmediate(key, { step: "calendar" })
    expect(loadDraft(key, validate)).toEqual({ step: "calendar" })
  })

  it("corrupt JSON returns null", () => {
    sessionStorage.setItem("bitbudget-bad-draft", "{not json")
    expect(loadDraft("bitbudget-bad-draft", () => true)).toBeNull()
  })

  it("validator false drops draft", () => {
    saveDraftImmediate("bitbudget-invalid-draft", { n: 1 })
    expect(loadDraft("bitbudget-invalid-draft", () => false)).toBeNull()
  })

  it("clearDraft removes key", () => {
    saveDraftImmediate("bitbudget-clear-draft", { ok: true })
    clearDraft("bitbudget-clear-draft")
    expect(sessionStorage.getItem("bitbudget-clear-draft")).toBeNull()
  })

  it("saveDraft debounces writes", () => {
    vi.useFakeTimers()
    const key = "bitbudget-debounce-draft"
    saveDraft(key, { v: 1 })
    expect(sessionStorage.getItem(key)).toBeNull()
    vi.advanceTimersByTime(400)
    expect(sessionStorage.getItem(key)).toBe(JSON.stringify({ v: 1 }))
  })
})
