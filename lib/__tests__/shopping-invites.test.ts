// @vitest-environment node
import { describe, expect, it } from "vitest"
import {
  generateInviteToken,
  hashInviteToken,
  parseInviteFragment,
  parseInviteFragmentParts,
  shoppingInviteUrl,
  generateInviteJoinCode,
  generateRequestVerificationCode,
  isInviteJoinCode,
  isRequestVerificationCode,
} from "../shopping-invites"
import {
  captureInviteFromLocation,
  loadPendingShoppingInvite,
  clearPendingShoppingInvite,
} from "../shopping-invite-handoff"
import {
  assertExpectedRevision,
  ShoppingRevisionConflictError,
  planShoppingEventPage,
  shoppingEventSnapshotWhere,
  shoppingEventWindowStart,
} from "../shopping-sync"

function mockSessionStorage() {
  const store: Record<string, string> = {}
  globalThis.sessionStorage = {
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
  } as Storage
  return store
}

describe("shopping invites", () => {
  it("hashes tokens without storing the raw value", async () => {
    const token = generateInviteToken()
    const hash = await hashInviteToken(token)
    expect(hash).toHaveLength(64)
    expect(hash).not.toBe(token)
    expect(await hashInviteToken(token)).toBe(hash)
  })

  it("puts the capability and 64-bit join code in the fragment", () => {
    const token = "abcdefghijklmnopqrstuv"
    const join = "0123456789abcdef"
    const url = shoppingInviteUrl("https://app.bitbudget.example", token, null, join)
    expect(url).toBe(`https://app.bitbudget.example/shopping-invite#${token}.${join}`)
    expect(parseInviteFragment(`#${token}.${join}`)).toBe(token)
    expect(parseInviteFragmentParts(`#${token}.${join}`)).toEqual({
      token,
      joinCode: join,
      ownerPublicKey: null,
    })
    expect(parseInviteFragment("not valid")).toBeNull()
  })

  it("appends join code then owner public key when sharing", () => {
    const token = "abcdefghijklmnopqrstuv"
    const join = "fedcba9876543210"
    const pk = "a".repeat(64)
    const url = shoppingInviteUrl("https://app.bitbudget.example", token, pk, join)
    expect(url).toBe(`https://app.bitbudget.example/shopping-invite#${token}.${join}.${pk}`)
    expect(parseInviteFragmentParts(`#${token}.${join}.${pk}`)).toEqual({
      token,
      joinCode: join,
      ownerPublicKey: pk,
    })
  })

  it("still parses legacy token.ownerPk fragments without a join code", () => {
    const token = "abcdefghijklmnopqrstuv"
    const pk = "b".repeat(64)
    expect(parseInviteFragmentParts(`#${token}.${pk}`)).toEqual({
      token,
      joinCode: null,
      ownerPublicKey: pk,
    })
  })

  it("generates a 64-bit hex join code", () => {
    const code = generateInviteJoinCode()
    expect(code).toMatch(/^[0-9a-f]{16}$/)
    expect(isInviteJoinCode(code)).toBe(true)
    expect(isRequestVerificationCode(code)).toBe(true)
    expect(isRequestVerificationCode(generateRequestVerificationCode())).toBe(true)
    expect(isRequestVerificationCode("ABCDEF")).toBe(true) // legacy spoken form
    expect(isRequestVerificationCode("short")).toBe(false)
  })
})

describe("invite handoff", () => {
  it("captures token, join code, and clears on demand", () => {
    mockSessionStorage()
    let replaced = false
    const join = "0123456789abcdef"
    const captured = captureInviteFromLocation(`#tokentoken12345678.${join}`, () => {
      replaced = true
    })
    expect(captured?.token).toBe("tokentoken12345678")
    expect(captured?.joinCode).toBe(join)
    expect(captured?.ownerPublicKey).toBeNull()
    expect(replaced).toBe(true)
    expect(loadPendingShoppingInvite()?.joinCode).toBe(join)
    clearPendingShoppingInvite()
    expect(loadPendingShoppingInvite()).toBeNull()
  })

  it("stores a lowercase owner public key from the fragment", () => {
    mockSessionStorage()
    const pk = "ab".repeat(32)
    const join = "fedcba9876543210"
    const captured = captureInviteFromLocation(`#tokentoken12345678.${join}.${pk}`)
    expect(captured?.ownerPublicKey).toBe(pk)
    expect(captured?.joinCode).toBe(join)
    expect(loadPendingShoppingInvite()?.ownerPublicKey).toBe(pk)
    clearPendingShoppingInvite()
  })
})

describe("shopping sync CAS", () => {
  it("surfaces a conflict when the expected revision is stale", () => {
    expect(() => assertExpectedRevision(2, 1)).toThrow(ShoppingRevisionConflictError)
    expect(() => assertExpectedRevision(3, 3)).not.toThrow()
  })
})

describe("shopping event snapshot window", () => {
  it("returns the full ledger when eventSequence fits in one page", () => {
    expect(shoppingEventWindowStart(0)).toBeNull()
    expect(shoppingEventWindowStart(50)).toBe(1)
    expect(shoppingEventWindowStart(100)).toBe(1)
    expect(shoppingEventSnapshotWhere(80)).toEqual({})
  })

  it("tails the newest events when the ledger exceeds the page size", () => {
    expect(shoppingEventWindowStart(101)).toBe(2)
    expect(shoppingEventWindowStart(150)).toBe(51)
    expect(shoppingEventSnapshotWhere(150)).toEqual({ sequence: { gte: 51 } })
  })
})

describe("shopping event page plan", () => {
  it("walks forward from afterSequence and asks for one extra row", () => {
    expect(planShoppingEventPage({ afterSequence: 0, beforeSequence: null })).toEqual({
      ok: true,
      sequence: { gt: 0 },
      order: "asc",
      take: 101,
      pageSize: 100,
      reverse: false,
    })
    expect(planShoppingEventPage({ afterSequence: 40, beforeSequence: null, pageSize: 2 })).toMatchObject({
      sequence: { gt: 40 },
      take: 3,
      pageSize: 2,
      reverse: false,
    })
  })

  it("walks backward from beforeSequence so a tail snapshot can load the previous page", () => {
    const plan = planShoppingEventPage({ afterSequence: null, beforeSequence: 51, pageSize: 100 })
    expect(plan).toEqual({
      ok: true,
      sequence: { lt: 51 },
      order: "desc",
      take: 101,
      pageSize: 100,
      reverse: true,
    })
  })

  it("rejects both cursors, a missing cursor, and a non-integer page size", () => {
    expect(planShoppingEventPage({ afterSequence: 1, beforeSequence: 2 })).toEqual({
      ok: false,
      reason: "both",
    })
    expect(planShoppingEventPage({ afterSequence: null, beforeSequence: null })).toEqual({
      ok: false,
      reason: "invalid",
    })
    expect(planShoppingEventPage({ afterSequence: 1.5, beforeSequence: null }).ok).toBe(false)
    expect(planShoppingEventPage({ afterSequence: -1, beforeSequence: null }).ok).toBe(false)
    expect(planShoppingEventPage({ afterSequence: null, beforeSequence: -1 }).ok).toBe(false)
    expect(planShoppingEventPage({ afterSequence: null, beforeSequence: 1.2 }).ok).toBe(false)
    expect(planShoppingEventPage({ afterSequence: 0, beforeSequence: null, pageSize: 1.5 })).toEqual({
      ok: false,
      reason: "invalid",
    })
  })

  it("clamps page size into 1..100", () => {
    expect(planShoppingEventPage({ afterSequence: 0, beforeSequence: null, pageSize: 0 })).toMatchObject({
      pageSize: 1,
      take: 2,
    })
    expect(planShoppingEventPage({ afterSequence: null, beforeSequence: 10, pageSize: 500 })).toMatchObject({
      pageSize: 100,
      take: 101,
      reverse: true,
    })
  })
})
