// @vitest-environment node
import { describe, expect, it } from "vitest"
import {
  generateInviteToken,
  hashInviteToken,
  parseInviteFragment,
  shoppingInviteUrl,
  generateRequestVerificationCode,
  isRequestVerificationCode,
} from "../shopping-invites"
import { captureInviteFromLocation, loadPendingShoppingInvite, clearPendingShoppingInvite } from "../shopping-invite-handoff"
import {
  assertExpectedRevision,
  ShoppingRevisionConflictError,
  planShoppingEventPage,
  shoppingEventSnapshotWhere,
  shoppingEventWindowStart,
} from "../shopping-sync"

describe("shopping invites", () => {
  it("hashes tokens without storing the raw value", async () => {
    const token = generateInviteToken()
    const hash = await hashInviteToken(token)
    expect(hash).toHaveLength(64)
    expect(hash).not.toBe(token)
    expect(await hashInviteToken(token)).toBe(hash)
  })

  it("puts the capability in the fragment", () => {
    const token = "abcdefghijklmnopqrstuv"
    const url = shoppingInviteUrl("https://app.bitbudget.example", token)
    expect(url).toBe(`https://app.bitbudget.example/shopping-invite#${token}`)
    expect(parseInviteFragment(`#${token}`)).toBe(token)
    expect(parseInviteFragment("not valid")).toBeNull()
  })

  it("appends the owner public key after the token when sharing", () => {
    const token = "abcdefghijklmnopqrstuv"
    const pk = "a".repeat(64)
    const url = shoppingInviteUrl("https://app.bitbudget.example", token, pk)
    expect(url).toBe(`https://app.bitbudget.example/shopping-invite#${token}.${pk}`)
    expect(parseInviteFragment(`#${token}.${pk}`)).toBe(token)
  })

  it("generates a short verification code", () => {
    const code = generateRequestVerificationCode()
    expect(isRequestVerificationCode(code)).toBe(true)
  })
})

describe("invite handoff", () => {
  it("captures a fragment token into sessionStorage", () => {
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
    let replaced = false
    const captured = captureInviteFromLocation("#tokentoken12345678.ab", () => {
      replaced = true
    })
    expect(captured?.token).toBe("tokentoken12345678")
    expect(captured?.ownerPublicKey).toBeNull()
    expect(replaced).toBe(true)
    expect(loadPendingShoppingInvite()?.token).toBe("tokentoken12345678")
    clearPendingShoppingInvite()
    expect(loadPendingShoppingInvite()).toBeNull()
  })

  it("stores a lowercase owner public key from the fragment", () => {
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
    const pk = "ab".repeat(32)
    const captured = captureInviteFromLocation(`#tokentoken12345678.${pk}`)
    expect(captured?.ownerPublicKey).toBe(pk)
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
