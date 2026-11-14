// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest"
import {
  captureInviteFromLocation,
  capturePendingShoppingInvite,
  clearPendingShoppingInvite,
  loadPendingShoppingInvite,
} from "../shopping-invite-handoff"

function mockStorage(): Storage {
  const store: Record<string, string> = {}
  return {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => {
      store[k] = v
    },
    removeItem: (k: string) => {
      delete store[k]
    },
    clear: () => {
      for (const k of Object.keys(store)) delete store[k]
    },
    key: () => null,
    length: 0,
  }
}

describe("shopping invite handoff storage", () => {
  afterEach(() => {
    clearPendingShoppingInvite()
  })

  it("persists in localStorage so a later session can still load the invite", () => {
    const local = mockStorage()
    const session = mockStorage()
    Object.defineProperty(globalThis, "localStorage", { value: local, configurable: true })
    Object.defineProperty(globalThis, "sessionStorage", { value: session, configurable: true })

    capturePendingShoppingInvite("tokentoken12345678", "ab".repeat(32))
    expect(local.getItem("bitbudget-pending-shopping-invite")).toBe("tokentoken12345678")
    expect(session.getItem("bitbudget-pending-shopping-invite")).toBe("tokentoken12345678")

    // Simulate a fresh tab that only has localStorage (logout cleared nothing).
    Object.defineProperty(globalThis, "sessionStorage", { value: mockStorage(), configurable: true })
    const loaded = loadPendingShoppingInvite()
    expect(loaded?.token).toBe("tokentoken12345678")
    expect(loaded?.ownerPublicKey).toBe("ab".repeat(32))
  })

  it("captures a fragment into storage and clears on explicit dismiss", () => {
    Object.defineProperty(globalThis, "localStorage", { value: mockStorage(), configurable: true })
    Object.defineProperty(globalThis, "sessionStorage", { value: mockStorage(), configurable: true })
    let replaced = false
    const captured = captureInviteFromLocation("#tokentoken12345678.ab", () => {
      replaced = true
    })
    expect(captured?.token).toBe("tokentoken12345678")
    expect(replaced).toBe(true)
    expect(loadPendingShoppingInvite()?.token).toBe("tokentoken12345678")
    clearPendingShoppingInvite()
    expect(loadPendingShoppingInvite()).toBeNull()
  })
})
