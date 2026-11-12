import "./load-env"
import type { Page } from "@playwright/test"
import { test, expect, request } from "@playwright/test"
import { prisma } from "../lib/db"
import {
  E2E_REFERRER_PREMIUM_EMAIL,
  E2E_USER_CODE_FREE_REFERRER,
  E2E_USER_CODE_PREMIUM_REFERRER,
  E2E_OFFER_SLUG,
  E2E_EXHAUSTED_CODE,
} from "./fixtures/referral-e2e-constants"
import { signInWithE2eEmail } from "./helpers/auth-email"
import { withPgSessionTimeZone } from "./helpers/pg-session-timezone"
import {
  completePlaidLinkSandbox,
  expectPlaidConnectSuccessDialog,
  expectPremiumTrialSpanDays,
  isPlaidSandboxConfigured,
  openSettingsIntegrations,
} from "./helpers/plaid-link"
import { dismissWalkthroughIfPresent } from "./helpers/shell"
import { redeemReferralCode } from '@/lib/referral'
import {
  E2E_TEST_ENCRYPTED_PRIVACY_KEY_JSON,
  E2E_TEST_PRIVACY_KEY_SALT_HEX,
} from "./fixtures/encryption-e2e-constants"
import { primePrivacyKeyCache, unlockPassphraseIfNeeded } from "./helpers/privacy-cache"

function pgHostFromDatabaseUrl(url: string | undefined): string | null {
  if (!url) return null
  const m = url.match(/@([^/?]+)(?:\/|\?|$)/)
  return m?.[1] ?? null
}

test.beforeAll(async () => {
  const port = process.env.PW_SERVER_PORT || "3100"
  const base = process.env.PLAYWRIGHT_BASE_URL || `http://127.0.0.1:${port}`
  const ctx = await request.newContext({ baseURL: base })
  try {
    const res = await ctx.post("/api/e2e/reset-referral-seed", {
      headers: { "Content-Type": "application/json" },
      data: "{}",
    })
    const j = (await res.json()) as { ok?: boolean; dbHost?: string | null }
    expect(res.ok(), JSON.stringify(j)).toBeTruthy()
    const workerHost = pgHostFromDatabaseUrl(process.env.DATABASE_URL)
    expect(
      j.dbHost,
      `Worker DATABASE_URL host (${workerHost}) must match Next server (${j.dbHost}).`,
    ).toBe(workerHost)
  } finally {
    await ctx.dispose()
  }
})

/**
 * Use the browser’s fetch + cookies — `page.request` does not reliably send the session cookie
 * jar for same-origin API routes after client-side auth in this app.
 */
async function fetchJsonInPage(
  page: Page,
  path: string,
  init: { method?: string; body?: Record<string, unknown> } = {},
): Promise<{ status: number; json: Record<string, unknown> | null }> {
  const method = init.method ?? "GET"
  const body = init.body
  return page.evaluate(
    async ({ path: p, method: m, body: b }) => {
      const r = await fetch(p, {
        method: m,
        headers: b ? { "Content-Type": "application/json" } : undefined,
        credentials: "include",
        body: b ? JSON.stringify(b) : undefined,
      })
      const text = await r.text()
      let json: Record<string, unknown> | null = null
      try {
        json = text ? (JSON.parse(text) as Record<string, unknown>) : null
      } catch {
        json = { _parseError: true, _raw: text.slice(0, 200) }
      }
      return { status: r.status, json }
    },
    { path, method, body },
  )
}

async function redeemReferralCodeInBrowser(page: Page, code: string): Promise<void> {
  const redeem = await fetchJsonInPage(page, "/api/referral/redeem", {
    method: "POST",
    body: { code, shareMethod: "e2e" },
  })
  expect(redeem.status).toBe(200)
}

/** Referral redeem works via API before onboarding; Plaid UI needs app shell + encryption. */
async function bootstrapReferreeAppShell(page: Page, origin: string): Promise<void> {
  const email = await page.evaluate(async () => {
    const r = await fetch("/api/auth/session", { credentials: "include" })
    const j = (await r.json()) as { user?: { email?: string } }
    return j.user?.email ?? null
  })
  expect(email).toBeTruthy()

  await prisma.user.update({
    where: { email: email! },
    data: {
      onboardingComplete: true,
      onboardingCompletedAt: new Date(),
      walkthroughCompleted: true,
      encryptedPrivacyKey: E2E_TEST_ENCRYPTED_PRIVACY_KEY_JSON,
      privacyKeySalt: E2E_TEST_PRIVACY_KEY_SALT_HEX,
    },
  })

  const enc = await fetchJsonInPage(page, "/api/user/encryption")
  const userId = typeof enc.json?.userId === "string" ? enc.json.userId : ""
  expect(userId).toBeTruthy()

  await page.goto(`${origin}/#/dashboard`)
  await unlockPassphraseIfNeeded(page)
  await primePrivacyKeyCache(page, userId)
  await dismissWalkthroughIfPresent(page)
}

async function connectBankAndActivateReferralTrial(
  page: Page,
  origin: string,
  expectedTrialMonths: 1 | 3,
): Promise<void> {
  const before = await fetchJsonInPage(page, "/api/user/settings")
  expect(before.status).toBe(200)
  const beforeSettings = before.json as {
    referralRefereePendingBankLink?: boolean
    premiumTrialUntil?: string | null
    effectiveTier?: string
  }
  expect(beforeSettings.referralRefereePendingBankLink).toBe(true)
  expect(beforeSettings.effectiveTier).toBe("free")
  expect(beforeSettings.premiumTrialUntil == null || beforeSettings.premiumTrialUntil === "").toBeTruthy()

  await bootstrapReferreeAppShell(page, origin)
  await openSettingsIntegrations(page, origin)
  await dismissWalkthroughIfPresent(page)
  const connectBank = page.getByRole("button", { name: "Connect bank" })
  await expect(connectBank).toBeVisible({ timeout: 30_000 })
  await connectBank.click()
  await page.locator('iframe[title="Plaid Link"]').waitFor({ state: "attached", timeout: 60_000 })
  await completePlaidLinkSandbox(page)
  await expectPlaidConnectSuccessDialog(page)

  const after = await fetchJsonInPage(page, "/api/user/settings")
  expect(after.status).toBe(200)
  const afterSettings = after.json as {
    referralRefereePendingBankLink?: boolean
    effectiveTier?: string
    premiumTrialUntil?: string | null
  }
  expect(afterSettings.referralRefereePendingBankLink).toBe(false)
  expect(afterSettings.effectiveTier).toBe("premium-trial")
  expect(typeof afterSettings.premiumTrialUntil).toBe("string")
  expectPremiumTrialSpanDays(afterSettings.premiumTrialUntil!, expectedTrialMonths)

  const email = await page.evaluate(async () => {
    const r = await fetch("/api/auth/session", { credentials: "include" })
    const j = (await r.json()) as { user?: { email?: string } }
    return j.user?.email ?? null
  })
  expect(email).toBeTruthy()
  const ref = await prisma.referral.findFirst({
    where: { referee: { email: email! } },
    select: { status: true },
  })
  expect(ref?.status).toBe("activated")
}

test.describe("Referral program (API + DB)", () => {
  test("GET /api/referral/validate — empty code", async ({ request }) => {
    const res = await request.get("/api/referral/validate?code=")
    expect(res.ok()).toBeTruthy()
    const body = (await res.json()) as { valid: boolean; type: string | null }
    expect(body.valid).toBe(false)
    expect(body.type).toBeNull()
  })

  test("GET /api/referral/validate — premium referrer user code", async ({ request }) => {
    const res = await request.get(
      `/api/referral/validate?code=${encodeURIComponent(E2E_USER_CODE_PREMIUM_REFERRER)}`,
    )
    expect(res.ok()).toBeTruthy()
    const body = (await res.json()) as {
      valid: boolean
      type: string
      refereeTrialMonths?: number
      referrerOpportunityCostEnabled?: boolean
    }
    expect(body.valid).toBe(true)
    expect(body.type).toBe("user")
    expect(body.refereeTrialMonths).toBe(3)
    expect(body.referrerOpportunityCostEnabled).toBe(true)
  })

  test("GET /api/referral/validate — free referrer user code → 1 month carrot", async ({ request }) => {
    const res = await request.get(
      `/api/referral/validate?code=${encodeURIComponent(E2E_USER_CODE_FREE_REFERRER)}`,
    )
    expect(res.ok()).toBeTruthy()
    const body = (await res.json()) as {
      valid: boolean
      refereeTrialMonths?: number
      referrerOpportunityCostEnabled?: boolean
    }
    expect(body.valid).toBe(true)
    expect(body.refereeTrialMonths).toBe(1)
    expect(body.referrerOpportunityCostEnabled).toBe(false)
  })

  test("GET /api/referral/validate — offer slug", async ({ request }) => {
    const res = await request.get(`/api/referral/validate?code=${encodeURIComponent(E2E_OFFER_SLUG)}`)
    expect(res.ok()).toBeTruthy()
    const body = (await res.json()) as {
      valid: boolean
      type: string
      label?: string
      referrerOpportunityCostEnabled?: boolean
    }
    expect(body.valid).toBe(true)
    expect(body.type).toBe("offer")
    expect(body.label).toBe("E2E Offer")
    expect(body.referrerOpportunityCostEnabled).toBe(true)
  })

  test("GET /api/referral/validate — exhausted code", async ({ request }) => {
    const res = await request.get(
      `/api/referral/validate?code=${encodeURIComponent(E2E_EXHAUSTED_CODE)}`,
    )
    expect(res.ok()).toBeTruthy()
    const body = (await res.json()) as { valid: boolean }
    expect(body.valid).toBe(false)
  })

  test("redeemReferralCode — fresh startsAt=now under America/Los_Angeles session TZ", async () => {
    const premiumReferrer = await prisma.user.findUnique({
      where: { email: E2E_REFERRER_PREMIUM_EMAIL },
      select: { id: true },
    })
    expect(premiumReferrer?.id, "e2e seed missing — run globalSetup").toBeTruthy()

    const now = new Date()
    const expiresAt = new Date(now.getTime() + 7 * 86400000)
    const code = `E2EF${(Date.now() % 1_000_000).toString(36).toUpperCase().padStart(4, "0")}`

    const codeRow = await prisma.referralCode.create({
      data: {
        code,
        type: "user",
        ownerId: premiumReferrer!.id,
        maxUses: 1,
        usedCount: 0,
        /** Production + `pnpm referral:admin-code` use `startsAt: now` — not the backdated e2e seed. */
        startsAt: now,
        expiresAt,
        active: true,
      },
    })

    const referee = await prisma.user.create({
      data: {
        email: `e2e-referee-fresh-tz-${Date.now()}@bitbudget.test`,
        name: "E2E Fresh TZ Referee",
        subscriptionTier: "free",
        onboardingComplete: false,
      },
    })

    try {
      await withPgSessionTimeZone("America/Los_Angeles", async () => {
        const [dateCheck] = await prisma.$queryRaw<
          Array<{ naive_starts_ok: boolean; utc_starts_ok: boolean }>
        >`
          SELECT
            "startsAt" <= ${now} AS naive_starts_ok,
            ("startsAt" AT TIME ZONE 'UTC') <= ${now} AS utc_starts_ok
          FROM "ReferralCode"
          WHERE id = ${codeRow.id}
        `
        expect(dateCheck?.utc_starts_ok).toBe(true)
        expect(
          dateCheck?.naive_starts_ok,
          "non-UTC session should expose naive timestamp vs timestamptz mismatch for fresh codes",
        ).toBe(false)

        const result = await redeemReferralCode({
          refereeId: referee.id,
          rawCode: codeRow.code,
          shareMethod: "e2e",
          now,
        })
        expect(result, JSON.stringify(result)).toEqual({
          ok: true,
          codeType: "user",
          referrerId: premiumReferrer!.id,
        })
      })

      const updated = await prisma.referralCode.findUnique({
        where: { id: codeRow.id },
        select: { usedCount: true },
      })
      expect(updated?.usedCount).toBe(1)

      const referral = await prisma.referral.findUnique({ where: { refereeId: referee.id } })
      expect(referral?.status).toBe("accepted")
    } finally {
      await prisma.referral.deleteMany({ where: { refereeId: referee.id } }).catch(() => {})
      await prisma.user.delete({ where: { id: referee.id } }).catch(() => {})
      await prisma.referralCode.delete({ where: { id: codeRow.id } }).catch(() => {})
    }
  })

  test("POST /api/referral/redeem — fresh startsAt=now via API (production-like code)", async ({
    page,
    baseURL,
  }) => {
    const premiumReferrer = await prisma.user.findUnique({
      where: { email: E2E_REFERRER_PREMIUM_EMAIL },
      select: { id: true },
    })
    expect(premiumReferrer?.id).toBeTruthy()

    const now = new Date()
    const code = `E2EA${(Date.now() % 1_000_000).toString(36).toUpperCase().padStart(4, "0")}`
    const codeRow = await prisma.referralCode.create({
      data: {
        code,
        type: "user",
        ownerId: premiumReferrer!.id,
        maxUses: 1,
        usedCount: 0,
        startsAt: now,
        expiresAt: new Date(now.getTime() + 7 * 86400000),
        active: true,
      },
    })

    const email = `e2e-referee-fresh-api-${Date.now()}@bitbudget.test`
    try {
      await signInWithE2eEmail(page, baseURL!, email)

      const redeem = await fetchJsonInPage(page, "/api/referral/redeem", {
        method: "POST",
        body: { code: codeRow.code, shareMethod: "e2e" },
      })
      expect(redeem.status, JSON.stringify(redeem.json)).toBe(200)

      const updated = await prisma.referralCode.findUnique({
        where: { id: codeRow.id },
        select: { usedCount: true },
      })
      expect(updated?.usedCount).toBe(1)
    } finally {
      const u = await prisma.user.findUnique({ where: { email }, select: { id: true } })
      if (u) {
        await prisma.referral.deleteMany({ where: { refereeId: u.id } }).catch(() => {})
        await prisma.user.delete({ where: { id: u.id } }).catch(() => {})
      }
      await prisma.referralCode.delete({ where: { id: codeRow.id } }).catch(() => {})
    }
  })

  test("POST /api/referral/redeem — happy path, settings show pending bank link", async ({
    page,
    baseURL,
  }) => {
    const email = `e2e-referee-redeem-${Date.now()}@bitbudget.test`
    await signInWithE2eEmail(page, baseURL!, email)

    const redeem = await fetchJsonInPage(page, "/api/referral/redeem", {
      method: "POST",
      body: { code: E2E_USER_CODE_PREMIUM_REFERRER, shareMethod: "e2e" },
    })
    expect(redeem.status).toBe(200)

    const settings = await fetchJsonInPage(page, "/api/user/settings")
    expect(settings.status).toBe(200)
    const s = settings.json as {
      referralRefereePendingBankLink?: boolean
      effectiveTier?: string
      premiumTrialUntil?: string | null
      opportunityCostEnabled?: boolean
    }
    expect(s.referralRefereePendingBankLink).toBe(true)
    expect(s.effectiveTier).toBe("free")
    expect(s.premiumTrialUntil == null || s.premiumTrialUntil === "").toBeTruthy()
    expect(s.opportunityCostEnabled).toBe(true)
  })

  test("POST /api/referral/redeem — referee inherits vanilla when free-tier referrer", async ({
    page,
    baseURL,
  }) => {
    const email = `e2e-referee-oc-free-${Date.now()}@bitbudget.test`
    await signInWithE2eEmail(page, baseURL!, email)

    const redeem = await fetchJsonInPage(page, "/api/referral/redeem", {
      method: "POST",
      body: { code: E2E_USER_CODE_FREE_REFERRER, shareMethod: "e2e" },
    })
    expect(redeem.status).toBe(200)

    const settings = await fetchJsonInPage(page, "/api/user/settings")
    expect(settings.status).toBe(200)
    const s = settings.json as { opportunityCostEnabled?: boolean }
    expect(s.opportunityCostEnabled).toBe(false)
  })

  test("POST /api/referral/redeem — idempotent conflict on second redeem", async ({ page, baseURL }) => {
    const email = `e2e-referee-double-${Date.now()}@bitbudget.test`
    await signInWithE2eEmail(page, baseURL!, email)

    const first = await fetchJsonInPage(page, "/api/referral/redeem", {
      method: "POST",
      body: { code: E2E_USER_CODE_FREE_REFERRER },
    })
    expect(first.status).toBe(200)

    const second = await fetchJsonInPage(page, "/api/referral/redeem", {
      method: "POST",
      body: { code: E2E_USER_CODE_PREMIUM_REFERRER },
    })
    expect(second.status).toBe(409)
    expect(second.json?.code).toBe("already_redeemed")
  })

  test("POST /api/referral/redeem — self-referral rejected", async ({ page, baseURL }) => {
    await signInWithE2eEmail(page, baseURL!, E2E_REFERRER_PREMIUM_EMAIL)

    const res = await fetchJsonInPage(page, "/api/referral/redeem", {
      method: "POST",
      body: { code: E2E_USER_CODE_PREMIUM_REFERRER },
    })
    expect(res.status).toBe(400)
    expect(res.json?.code).toBe("self_referral")
  })

  test("POST /api/user/referral-code — 400 before onboarding complete", async ({ page, baseURL }) => {
    const email = `e2e-no-onboard-${Date.now()}@bitbudget.test`
    await signInWithE2eEmail(page, baseURL!, email)

    const res = await fetchJsonInPage(page, "/api/user/referral-code", { method: "POST" })
    expect(res.status).toBe(400)
  })

  test("POST /api/user/referral-code — 200 after onboarding flagged", async ({ page, baseURL }) => {
    const email = `e2e-with-onboard-${Date.now()}@bitbudget.test`
    await signInWithE2eEmail(page, baseURL!, email)

    const u = await prisma.user.findUnique({ where: { email }, select: { id: true } })
    expect(u?.id).toBeTruthy()
    await prisma.user.update({
      where: { id: u!.id },
      data: { onboardingComplete: true },
    })

    const res = await fetchJsonInPage(page, "/api/user/referral-code", { method: "POST" })
    expect(res.status).toBe(200)
    const body = res.json as { code?: string; expiresAt?: string }
    expect(body.code).toBeTruthy()
    expect(body.code?.length).toBeGreaterThanOrEqual(6)
    expect(body.expiresAt).toBeTruthy()
  })
})

test.describe("Referral bank link (Plaid sandbox)", () => {
  test.skip(
    !isPlaidSandboxConfigured(),
    "Set PLAID_CLIENT_ID, PLAID_SECRET, and PLAID_ENV=sandbox to run connect-bank referral activation tests.",
  )
  test.describe.configure({ timeout: 180_000 })

  test("premium referrer → 3-month trial after Connect bank (user_good / pass_good)", async ({
    page,
    baseURL,
  }) => {
    const origin = baseURL!
    const email = `e2e-referee-plaid-prem-${Date.now()}@bitbudget.test`
    await signInWithE2eEmail(page, origin, email)
    await redeemReferralCodeInBrowser(page, E2E_USER_CODE_PREMIUM_REFERRER)
    await connectBankAndActivateReferralTrial(page, origin, 3)
  })

  test("free referrer → 1-month trial after Connect bank (user_good / pass_good)", async ({
    page,
    baseURL,
  }) => {
    const origin = baseURL!
    const email = `e2e-referee-plaid-free-${Date.now()}@bitbudget.test`
    await signInWithE2eEmail(page, origin, email)
    await redeemReferralCodeInBrowser(page, E2E_USER_CODE_FREE_REFERRER)
    await connectBankAndActivateReferralTrial(page, origin, 1)
  })
})
