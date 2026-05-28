// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  NOSTR_PROFILE_SYNC_COOLDOWN_MS,
  NOSTR_PROFILE_SYNC_MAX_FAILURES,
  resetNostrProfileSyncCooldown,
  runNostrProfileBackgroundSync,
  shouldAttemptNostrProfileSync,
} from "../nostr-profile-sync-client"

const pubkey = "b".repeat(64)
const storageKey = `bitbudget-nostr-profile-sync:${pubkey.slice(0, 16)}`

describe("shouldAttemptNostrProfileSync", () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

  it("allows sync when no prior progress exists", () => {
    expect(shouldAttemptNostrProfileSync(pubkey)).toBe(true)
  })

  it("skips after a successful sync", () => {
    sessionStorage.setItem(
      storageKey,
      JSON.stringify({ synced: true, failures: 0, lastFailureAt: null }),
    )
    expect(shouldAttemptNostrProfileSync(pubkey)).toBe(false)
  })

  it("pauses after repeated failures until cooldown elapses", () => {
    const now = Date.now()
    sessionStorage.setItem(
      storageKey,
      JSON.stringify({
        synced: false,
        failures: NOSTR_PROFILE_SYNC_MAX_FAILURES,
        lastFailureAt: now,
      }),
    )
    expect(shouldAttemptNostrProfileSync(pubkey, now + 1_000)).toBe(false)
    expect(shouldAttemptNostrProfileSync(pubkey, now + NOSTR_PROFILE_SYNC_COOLDOWN_MS)).toBe(true)
  })
})

describe("resetNostrProfileSyncCooldown", () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

  it("clears failure count after cooldown", () => {
    const now = Date.now()
    sessionStorage.setItem(
      storageKey,
      JSON.stringify({
        synced: false,
        failures: NOSTR_PROFILE_SYNC_MAX_FAILURES,
        lastFailureAt: now - NOSTR_PROFILE_SYNC_COOLDOWN_MS,
      }),
    )
    resetNostrProfileSyncCooldown(pubkey, now)
    expect(shouldAttemptNostrProfileSync(pubkey, now)).toBe(true)
  })
})

describe("runNostrProfileBackgroundSync", () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

  it("persists relay metadata and updates the session", async () => {
    const updateSession = vi.fn().mockResolvedValue(null)
    const fetchProfile = vi.fn().mockResolvedValue({
      name: "Alice",
      image: "https://cdn.test/a.png",
    })
    const postSync = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        updated: true,
        needsSync: false,
        name: "Alice",
        image: "https://cdn.test/a.png",
      }),
    })

    await expect(
      runNostrProfileBackgroundSync(pubkey, updateSession, {
        retryDelaysMs: [0],
        fetchProfile,
        postSync,
        sleepFn: async () => {},
      }),
    ).resolves.toBe(true)

    expect(postSync).toHaveBeenCalledWith({
      profileName: "Alice",
      profileImage: "https://cdn.test/a.png",
    })
    expect(updateSession).toHaveBeenCalledWith({
      name: "Alice",
      image: "https://cdn.test/a.png",
    })
    expect(shouldAttemptNostrProfileSync(pubkey)).toBe(false)
  })

  it("retries across delays when relays are initially empty", async () => {
    const fetchProfile = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ name: "Bob" })
    const postSync = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        updated: true,
        needsSync: false,
        name: "Bob",
        image: null,
      }),
    })
    const sleepFn = vi.fn().mockResolvedValue(undefined)

    await expect(
      runNostrProfileBackgroundSync(pubkey, vi.fn(), {
        retryDelaysMs: [0, 10],
        fetchProfile,
        postSync,
        sleepFn,
      }),
    ).resolves.toBe(true)

    expect(fetchProfile).toHaveBeenCalledTimes(2)
    expect(sleepFn).toHaveBeenCalledWith(10)
  })

  it("records failures when all attempts miss relay metadata", async () => {
    const fetchProfile = vi.fn().mockResolvedValue({})

    await expect(
      runNostrProfileBackgroundSync(pubkey, vi.fn(), {
        retryDelaysMs: [0, 0],
        fetchProfile,
        postSync: vi.fn(),
        sleepFn: async () => {},
      }),
    ).resolves.toBe(false)

    const stored = JSON.parse(sessionStorage.getItem(storageKey) ?? "{}") as {
      failures?: number
      synced?: boolean
    }
    expect(stored.synced).toBe(false)
    expect(stored.failures).toBe(1)
  })
})
