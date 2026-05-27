import { afterEach, describe, expect, it, vi } from "vitest"
import {
  canTakeReceiptPhoto,
  prefersNativeCaptureInput,
  receiptCameraMode,
  supportsLiveCamera,
} from "@/lib/receipt-camera-capability"

function mockMatchMedia(results: Record<string, boolean>) {
  const matchMedia = vi.fn((query: string) => ({
    matches: results[query] ?? false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
  vi.stubGlobal("matchMedia", matchMedia)
  if (typeof window !== "undefined") {
    Object.defineProperty(window, "matchMedia", { configurable: true, writable: true, value: matchMedia })
  }
}

describe("receipt camera capability", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("prefers capture input on touch-first devices", () => {
    mockMatchMedia({ "(pointer: coarse) and (hover: none)": true })
    expect(prefersNativeCaptureInput()).toBe(true)
    expect(receiptCameraMode()).toBe("capture-input")
  })

  it("uses live camera on desktop with getUserMedia", () => {
    mockMatchMedia({ "(pointer: coarse) and (hover: none)": false })
    vi.stubGlobal("navigator", {
      mediaDevices: { getUserMedia: vi.fn() },
    })
    expect(supportsLiveCamera()).toBe(true)
    expect(receiptCameraMode()).toBe("live")
    expect(canTakeReceiptPhoto()).toBe(true)
  })

  it("falls back to upload-only when no camera APIs exist", () => {
    mockMatchMedia({ "(pointer: coarse) and (hover: none)": false })
    vi.stubGlobal("navigator", {})
    expect(receiptCameraMode()).toBe("upload-only")
    expect(canTakeReceiptPhoto()).toBe(false)
  })
})
