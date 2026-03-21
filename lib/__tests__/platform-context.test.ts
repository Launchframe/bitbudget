// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest"
import { parsePlatform } from "../platform-context"

function setNavigator(ua: string, opts?: { maxTouchPoints?: number; ontouchstart?: boolean }) {
  vi.stubGlobal("navigator", {
    userAgent: ua,
    maxTouchPoints: opts?.maxTouchPoints ?? 0,
  })
  vi.stubGlobal("window", opts?.ontouchstart ? { ontouchstart: {} } : {})
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("parsePlatform", () => {
  it("detects Android Chrome", () => {
    setNavigator(
      "Mozilla/5.0 (Linux; Android 10; SM-G973F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.120 Mobile Safari/537.36",
    )
    const p = parsePlatform()
    expect(p.os).toBe("android")
    expect(p.browser).toBe("chrome")
    expect(p.isMobileDevice).toBe(true)
  })

  it("detects iOS Safari", () => {
    setNavigator(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    )
    const p = parsePlatform()
    expect(p.os).toBe("ios")
    expect(p.browser).toBe("safari")
  })

  it("treats iPadOS desktop-mode Safari (Macintosh + Mobile + touch) as iOS", () => {
    setNavigator(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      { maxTouchPoints: 5 },
    )
    const p = parsePlatform()
    expect(p.os).toBe("ios")
  })

  it("detects Edge before Chrome in UA", () => {
    setNavigator(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0",
    )
    const p = parsePlatform()
    expect(p.os).toBe("windows")
    expect(p.browser).toBe("edge")
  })

  it("returns default when navigator is undefined (SSR)", () => {
    vi.stubGlobal("navigator", undefined)
    vi.stubGlobal("window", undefined)
    const p = parsePlatform()
    expect(p.os).toBe("unknown")
    expect(p.browser).toBe("other")
  })
})
