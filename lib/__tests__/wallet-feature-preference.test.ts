import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  getWalletFeaturePreference,
  initializeWalletFeaturePreference,
  setWalletFeaturePreference,
  shouldLoadWalletFeature,
  walletFeaturePreferenceKey,
} from "@/lib/wallet-feature-preference"

function storageFixture() {
  const entries = new Map<string, string>()
  return {
    getItem: vi.fn((key: string) => entries.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { entries.set(key, value) }),
    removeItem: vi.fn((key: string) => { entries.delete(key) }),
  }
}

let storage: ReturnType<typeof storageFixture>
beforeEach(() => { storage = storageFixture() })

describe("wallet feature preference", () => {
  it("defaults to disabled, including unresolved accounts", () => {
    expect(getWalletFeaturePreference(null, storage)).toBe(false)
    expect(getWalletFeaturePreference("alice", storage)).toBe(false)
    expect(getWalletFeaturePreference("", storage)).toBe(false)
  })

  it("remembers activation for only the selected account", () => {
    expect(setWalletFeaturePreference("alice", true, storage)).toBe(true)
    expect(getWalletFeaturePreference("alice", storage)).toBe(true)
    expect(getWalletFeaturePreference("bob", storage)).toBe(false)
    setWalletFeaturePreference("alice", false, storage)
    expect(getWalletFeaturePreference("alice", storage)).toBe(false)
    expect(storage.removeItem).not.toHaveBeenCalled()
  })

  it.each(["true", "{", "null", '{"version":2,"enabled":true}', '{"version":1,"enabled":"true"}'])("fails closed for invalid saved state %s", (raw) => {
    storage.setItem(walletFeaturePreferenceKey("alice"), raw)
    expect(getWalletFeaturePreference("alice", storage)).toBe(false)
  })

  it("does not treat unavailable storage as authorization or activation", () => {
    const blocked = { getItem: () => { throw new Error("blocked") }, setItem: () => { throw new Error("blocked") } }
    expect(getWalletFeaturePreference("alice", blocked)).toBe(false)
    expect(setWalletFeaturePreference("alice", true, blocked)).toBe(false)
    expect(setWalletFeaturePreference(null, true, storage)).toBe(false)
  })

  it("does not overwrite an explicit disabled preference when opening the workspace again", () => {
    initializeWalletFeaturePreference("alice", storage)
    expect(getWalletFeaturePreference("alice", storage)).toBe(true)
    setWalletFeaturePreference("alice", false, storage)
    initializeWalletFeaturePreference("alice", storage)
    expect(getWalletFeaturePreference("alice", storage)).toBe(false)
    expect(storage.setItem).toHaveBeenCalledTimes(2)
  })

  it("uses a namespace separate from key material", () => {
    const key = walletFeaturePreferenceKey("alice")
    expect(key).toBe("bitbudget-wallet-feature-v1:alice")
    expect(key).not.toBe(walletFeaturePreferenceKey("bob"))
  })
})

describe("wallet feature loading gate", () => {
  const ready = { userId: "alice", bitcoinEnabled: true, accountReady: true, privacyReady: true, requested: false, remembered: false }

  it("requires explicit request or remembered activation", () => {
    expect(shouldLoadWalletFeature(ready)).toBe(false)
    expect(shouldLoadWalletFeature({ ...ready, requested: true })).toBe(true)
    expect(shouldLoadWalletFeature({ ...ready, remembered: true })).toBe(true)
  })

  it.each([
    { userId: null },
    { userId: "" },
    { bitcoinEnabled: false },
    { accountReady: false },
    { privacyReady: false },
  ])("never bypasses prerequisites with a deep link or cached activation: %j", (overrides) => {
    expect(shouldLoadWalletFeature({ ...ready, requested: true, remembered: true, ...overrides })).toBe(false)
  })
})
