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
import { assertExpectedRevision, ShoppingRevisionConflictError } from "../shopping-sync"

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
    expect(replaced).toBe(true)
    expect(loadPendingShoppingInvite()?.token).toBe("tokentoken12345678")
    clearPendingShoppingInvite()
    expect(loadPendingShoppingInvite()).toBeNull()
  })
})

describe("shopping sync CAS", () => {
  it("surfaces a conflict when the expected revision is stale", () => {
    expect(() => assertExpectedRevision(2, 1)).toThrow(ShoppingRevisionConflictError)
    expect(() => assertExpectedRevision(3, 3)).not.toThrow()
  })
})
