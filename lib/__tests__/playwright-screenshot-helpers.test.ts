// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest"
import { dialogContentLooksSettled } from "../../scripts/lib/playwright-screenshot-helpers.mjs"
import { defaultScreenshotOutDir } from "../../scripts/lib/playwright-screenshot-runtime.mjs"

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

  it("returns false while an enter animation is still running", () => {
    const el = document.createElement("div")
    el.style.opacity = "1"
    Object.defineProperty(el, "getAnimations", {
      value: () => [{ playState: "running" }],
    })
    expect(dialogContentLooksSettled(el)).toBe(false)
  })

  it("returns true after enter animations finish", () => {
    const el = document.createElement("div")
    el.style.opacity = "1"
    Object.defineProperty(el, "getAnimations", {
      value: () => [{ playState: "finished" }],
    })
    expect(dialogContentLooksSettled(el)).toBe(true)
  })
})

describe("defaultScreenshotOutDir", () => {
  const previous = process.env.OUT_DIR

  afterEach(() => {
    if (previous === undefined) delete process.env.OUT_DIR
    else process.env.OUT_DIR = previous
  })

  it("prefers OUT_DIR", () => {
    process.env.OUT_DIR = "/tmp/shopping-qa-shots"
    expect(defaultScreenshotOutDir()).toBe("/tmp/shopping-qa-shots")
  })
})
