import { describe, expect, it } from "vitest"
import { isBrowserOffline, shouldQueueMutation } from "@/lib/offline-queue"

describe("offline-queue helpers", () => {
  it("shouldQueueMutation returns true for TypeError (network failure)", () => {
    expect(shouldQueueMutation(new TypeError("Failed to fetch"))).toBe(true)
  })

  it("shouldQueueMutation returns false for generic errors", () => {
    expect(shouldQueueMutation(new Error("HTTP 500"))).toBe(false)
  })

  it("isBrowserOffline is false when navigator is undefined (SSR/tests)", () => {
    expect(isBrowserOffline()).toBe(false)
  })
})
