// @vitest-environment jsdom
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest"
import { findWalkthroughTarget } from "@/lib/walkthrough-target"

function mockRect(el: Element, width: number, height: number) {
  vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
    width,
    height,
    top: 0,
    left: 0,
    right: width,
    bottom: height,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect)
}

describe("findWalkthroughTarget", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <nav data-walkthrough="demo-target" id="nav"></nav>
      <main>
        <div data-walkthrough="demo-target" id="main-target"></div>
      </main>
    `
    mockRect(document.getElementById("nav")!, 10, 10)
    mockRect(document.getElementById("main-target")!, 10, 10)
  })

  afterEach(() => {
    document.body.innerHTML = ""
    vi.restoreAllMocks()
  })

  it("prefers the visible anchor inside main when duplicates exist", () => {
    const el = findWalkthroughTarget("demo-target")
    expect(el?.id).toBe("main-target")
  })

  it("skips hidden anchors when a visible duplicate exists", () => {
    document.body.innerHTML = `
      <nav data-walkthrough="app-nav" id="sidebar" style="display:none"></nav>
      <nav data-walkthrough="app-nav" id="mobile"></nav>
    `
    mockRect(document.getElementById("sidebar")!, 0, 0)
    mockRect(document.getElementById("mobile")!, 48, 48)

    const el = findWalkthroughTarget("app-nav")
    expect(el?.id).toBe("mobile")
  })

  it("returns null for a single hidden anchor", () => {
    document.body.innerHTML = `<nav data-walkthrough="solo" id="solo" style="display:none"></nav>`
    mockRect(document.getElementById("solo")!, 0, 0)
    expect(findWalkthroughTarget("solo")).toBeNull()
  })

  it("prefers bottom nav FAB over in-page duplicate for new-transaction", () => {
    document.body.innerHTML = `
      <main>
        <button data-walkthrough="new-transaction" id="page-btn"></button>
      </main>
      <nav class="fixed bottom-0" data-walkthrough="app-nav">
        <button data-walkthrough="new-transaction" id="fab"></button>
      </nav>
    `
    mockRect(document.getElementById("page-btn")!, 120, 40)
    const fab = document.getElementById("fab")!
    vi.spyOn(fab, "getBoundingClientRect").mockReturnValue({
      width: 64,
      height: 64,
      top: 700,
      left: 180,
      right: 244,
      bottom: 764,
      x: 180,
      y: 700,
      toJSON: () => ({}),
    } as DOMRect)

    const el = findWalkthroughTarget("new-transaction")
    expect(el?.id).toBe("fab")
  })
})
