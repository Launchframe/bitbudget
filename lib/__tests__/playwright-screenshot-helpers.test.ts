// @vitest-environment jsdom
import { describe, expect, it } from "vitest"
import { dialogContentLooksSettled } from "../../scripts/lib/playwright-screenshot-helpers.mjs"

describe("dialogContentLooksSettled", () => {
  it("returns false when opacity is below 0.99", () => {
    const el = document.createElement("div")
    el.style.opacity = "0.5"
    expect(dialogContentLooksSettled(el)).toBe(false)
  })

  it("returns true when opacity is 1 and there are no animations", () => {
    const el = document.createElement("div")
    el.style.opacity = "1"
    expect(dialogContentLooksSettled(el)).toBe(true)
  })
})
