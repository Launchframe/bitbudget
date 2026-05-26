// @vitest-environment jsdom
import { describe, expect, it, beforeEach, afterEach } from "vitest"
import { findWalkthroughTarget } from "@/lib/walkthrough-target"

describe("findWalkthroughTarget", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <nav data-walkthrough="demo-target" style="width:10px;height:10px"></nav>
      <main>
        <div data-walkthrough="demo-target" style="width:10px;height:10px"></div>
      </main>
    `
  })

  afterEach(() => {
    document.body.innerHTML = ""
  })

  it("prefers the anchor inside main when duplicates exist", () => {
    const el = findWalkthroughTarget("demo-target")
    expect(el?.closest("main")).not.toBeNull()
  })
})
