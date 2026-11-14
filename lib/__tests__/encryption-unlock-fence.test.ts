// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest"
import {
  ENCRYPTION_UNLOCK_FENCE_KEY,
  bumpUnlockFence,
  currentUnlockFence,
  resetUnlockFenceForTests,
  shouldApplyUnlock,
} from "../encryption-unlock-fence"

describe("encryption unlock fence", () => {
  afterEach(() => {
    resetUnlockFenceForTests()
  })

  it("rejects an unlock that started before reset", () => {
    const atMount = currentUnlockFence()
    bumpUnlockFence()
    expect(shouldApplyUnlock(atMount)).toBe(false)
    expect(shouldApplyUnlock(currentUnlockFence())).toBe(true)
  })

  it("adopts a higher fence written by another tab", () => {
    const atMount = currentUnlockFence()
    localStorage.setItem(ENCRYPTION_UNLOCK_FENCE_KEY, "4")
    expect(shouldApplyUnlock(atMount)).toBe(false)
    expect(currentUnlockFence()).toBe(4)
    expect(shouldApplyUnlock(4)).toBe(true)
  })

  it("does not rewind when stored fence is older", () => {
    bumpUnlockFence()
    bumpUnlockFence()
    expect(currentUnlockFence()).toBe(2)
    localStorage.setItem(ENCRYPTION_UNLOCK_FENCE_KEY, "1")
    expect(currentUnlockFence()).toBe(2)
    expect(shouldApplyUnlock(2)).toBe(true)
  })
})
