import { beforeEach, describe, expect, it, vi } from "vitest"

const userFindUnique = vi.fn()
const referralFindUnique = vi.fn()
const transactionCount = vi.fn()
const pendingTransactionCount = vi.fn()

vi.mock("@/lib/db", () => ({
  prisma: {
    user: { findUnique: (...args: unknown[]) => userFindUnique(...args) },
    referral: { findUnique: (...args: unknown[]) => referralFindUnique(...args) },
    transaction: { count: (...args: unknown[]) => transactionCount(...args) },
    pendingTransaction: { count: (...args: unknown[]) => pendingTransactionCount(...args) },
  },
}))

import {
  assertPremiumTrialInboxAllowed,
  premiumForbiddenResponse,
  referralRefereePendingBankLink,
  requirePremium,
  requirePremiumOrTrial,
  requirePremiumOrTrialOrReferralBankLinkPending,
} from "@/lib/subscription"

const now = new Date("2026-06-15T12:00:00.000Z")
const future = new Date("2026-12-01T00:00:00.000Z")
const past = new Date("2026-01-01T00:00:00.000Z")

function mockUserTier(row: {
  subscriptionTier: string
  premiumGratisUntil?: Date | null
  premiumTrialUntil?: Date | null
}) {
  userFindUnique.mockResolvedValue({
    subscriptionTier: row.subscriptionTier,
    premiumGratisUntil: row.premiumGratisUntil ?? null,
    premiumTrialUntil: row.premiumTrialUntil ?? null,
  })
}

describe("requirePremium (paid or gratis only)", () => {
  beforeEach(() => {
    userFindUnique.mockReset()
    referralFindUnique.mockReset()
  })

  it("allows paid premium", async () => {
    mockUserTier({ subscriptionTier: "premium" })
    expect(await requirePremium("u1")).toBe(true)
  })

  it("allows active gratis window", async () => {
    mockUserTier({ subscriptionTier: "free", premiumGratisUntil: future })
    expect(await requirePremium("u1")).toBe(true)
  })

  it("denies premium-trial only", async () => {
    mockUserTier({ subscriptionTier: "free", premiumTrialUntil: future })
    expect(await requirePremium("u1")).toBe(false)
  })

  it("denies free tier", async () => {
    mockUserTier({
      subscriptionTier: "free",
      premiumGratisUntil: past,
      premiumTrialUntil: past,
    })
    expect(await requirePremium("u1")).toBe(false)
  })
})

describe("requirePremiumOrTrial (voice, receipt scan, inbox)", () => {
  beforeEach(() => {
    userFindUnique.mockReset()
    referralFindUnique.mockReset()
  })

  it("allows paid premium", async () => {
    mockUserTier({ subscriptionTier: "premium" })
    expect(await requirePremiumOrTrial("u1")).toBe(true)
  })

  it("allows active premium trial", async () => {
    mockUserTier({ subscriptionTier: "free", premiumTrialUntil: future })
    expect(await requirePremiumOrTrial("u1")).toBe(true)
  })

  it("allows gratis premium", async () => {
    mockUserTier({ subscriptionTier: "free", premiumGratisUntil: future })
    expect(await requirePremiumOrTrial("u1")).toBe(true)
  })

  it("denies expired trial and gratis", async () => {
    mockUserTier({
      subscriptionTier: "free",
      premiumGratisUntil: past,
      premiumTrialUntil: past,
    })
    expect(await requirePremiumOrTrial("u1")).toBe(false)
  })
})

describe("requirePremiumOrTrialOrReferralBankLinkPending (Plaid)", () => {
  beforeEach(() => {
    userFindUnique.mockReset()
    referralFindUnique.mockReset()
  })

  it("allows premium-trial without referral row", async () => {
    mockUserTier({ subscriptionTier: "free", premiumTrialUntil: future })
    referralFindUnique.mockResolvedValue(null)
    expect(await requirePremiumOrTrialOrReferralBankLinkPending("u1")).toBe(true)
  })

  it("allows referee pending bank link when tier is free", async () => {
    mockUserTier({ subscriptionTier: "free", premiumTrialUntil: past, premiumGratisUntil: past })
    referralFindUnique.mockResolvedValue({ status: "accepted" })
    expect(await requirePremiumOrTrialOrReferralBankLinkPending("u1")).toBe(true)
  })

  it("denies free tier without referral acceptance", async () => {
    mockUserTier({ subscriptionTier: "free", premiumTrialUntil: past, premiumGratisUntil: past })
    referralFindUnique.mockResolvedValue(null)
    expect(await requirePremiumOrTrialOrReferralBankLinkPending("u1")).toBe(false)
  })
})

describe("referralRefereePendingBankLink", () => {
  beforeEach(() => referralFindUnique.mockReset())

  it("returns true when referral status is accepted", async () => {
    referralFindUnique.mockResolvedValue({ status: "accepted" })
    expect(await referralRefereePendingBankLink("u1")).toBe(true)
  })

  it("returns false when no referral or other status", async () => {
    referralFindUnique.mockResolvedValue(null)
    expect(await referralRefereePendingBankLink("u1")).toBe(false)
    referralFindUnique.mockResolvedValue({ status: "activated" })
    expect(await referralRefereePendingBankLink("u1")).toBe(false)
  })
})

describe("assertPremiumTrialInboxAllowed", () => {
  beforeEach(() => {
    userFindUnique.mockReset()
    transactionCount.mockReset()
    pendingTransactionCount.mockReset()
    transactionCount.mockResolvedValue(0)
    pendingTransactionCount.mockResolvedValue(0)
  })

  it("allows full premium", async () => {
    mockUserTier({ subscriptionTier: "premium" })
    expect(await assertPremiumTrialInboxAllowed("u1", now)).toEqual({ ok: true })
  })

  it("allows trial under monthly cap", async () => {
    mockUserTier({ subscriptionTier: "free", premiumTrialUntil: future })
    expect(await assertPremiumTrialInboxAllowed("u1", now)).toEqual({ ok: true })
  })

  it("blocks trial at monthly cap", async () => {
    mockUserTier({ subscriptionTier: "free", premiumTrialUntil: future })
    transactionCount.mockResolvedValue(50)
    pendingTransactionCount.mockResolvedValue(50)
    const result = await assertPremiumTrialInboxAllowed("u1", now)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain("100")
  })

  it("blocks free tier", async () => {
    mockUserTier({ subscriptionTier: "free", premiumTrialUntil: past })
    const result = await assertPremiumTrialInboxAllowed("u1", now)
    expect(result.ok).toBe(false)
  })
})

describe("premiumForbiddenResponse", () => {
  it("returns 403 JSON with custom message", async () => {
    const res = premiumForbiddenResponse("Voice entry requires premium or an active premium trial")
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body).toEqual({
      error: "Forbidden",
      message: "Voice entry requires premium or an active premium trial",
    })
  })
})
