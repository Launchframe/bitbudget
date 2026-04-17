import "./load-env"
import type { Page } from "@playwright/test"
import { test, expect, request } from "@playwright/test"
import { activateReferral, redeemReferralCode } from "../lib/referral"
import { prisma } from "../lib/db"
import {
  E2E_REFERRER_PREMIUM_EMAIL,
  E2E_USER_CODE_FREE_REFERRER,
  E2E_USER_CODE_PREMIUM_REFERRER,
  E2E_OFFER_SLUG,
  E2E_EXHAUSTED_CODE,
} from "./fixtures/referral-e2e-constants"
import { signInWithE2eEmail } from "./helpers/auth-email"

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
      body: "{}",
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
    }
    expect(body.valid).toBe(true)
    expect(body.type).toBe("user")
    expect(body.refereeTrialMonths).toBe(3)
  })

  test("GET /api/referral/validate — free referrer user code → 1 month carrot", async ({ request }) => {
    const res = await request.get(
      `/api/referral/validate?code=${encodeURIComponent(E2E_USER_CODE_FREE_REFERRER)}`,
    )
    expect(res.ok()).toBeTruthy()
    const body = (await res.json()) as { valid: boolean; refereeTrialMonths?: number }
    expect(body.valid).toBe(true)
    expect(body.refereeTrialMonths).toBe(1)
  })

  test("GET /api/referral/validate — offer slug", async ({ request }) => {
    const res = await request.get(`/api/referral/validate?code=${encodeURIComponent(E2E_OFFER_SLUG)}`)
    expect(res.ok()).toBeTruthy()
    const body = (await res.json()) as { valid: boolean; type: string; label?: string }
    expect(body.valid).toBe(true)
    expect(body.type).toBe("offer")
    expect(body.label).toBe("E2E Offer")
  })

  test("GET /api/referral/validate — exhausted code", async ({ request }) => {
    const res = await request.get(
      `/api/referral/validate?code=${encodeURIComponent(E2E_EXHAUSTED_CODE)}`,
    )
    expect(res.ok()).toBeTruthy()
    const body = (await res.json()) as { valid: boolean }
    expect(body.valid).toBe(false)
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
    }
    expect(s.referralRefereePendingBankLink).toBe(true)
    expect(s.effectiveTier).toBe("free")
    expect(s.premiumTrialUntil == null || s.premiumTrialUntil === "").toBeTruthy()
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

  test("activateReferral — sets referee premium trial (3mo from premium referrer)", async () => {
    const seeded = await prisma.referralCode.findUnique({
      where: { code: E2E_USER_CODE_PREMIUM_REFERRER },
      select: { id: true, usedCount: true, maxUses: true },
    })
    expect(seeded, "e2e seed missing — run globalSetup / check DATABASE_URL").toBeTruthy()

    const email = `e2e-referee-activate-${Date.now()}@bitbudget.test`
    const user = await prisma.user.create({
      data: { email, name: "E2E Activate", subscriptionTier: "free", onboardingComplete: false },
    })

    const redeemResult = await redeemReferralCode({
      refereeId: user.id,
      rawCode: E2E_USER_CODE_PREMIUM_REFERRER,
      shareMethod: "e2e",
    })
    expect(redeemResult.ok).toBe(true)

    const before = await prisma.user.findUnique({
      where: { id: user.id },
      select: { premiumTrialUntil: true },
    })
    expect(before?.premiumTrialUntil).toBeNull()

    const act1 = await activateReferral(user.id)
    expect(act1.didActivate).toBe(true)
    expect(act1.refereeTrialMonths).toBe(3)

    const act2 = await activateReferral(user.id)
    expect(act2.didActivate).toBe(false)

    const after = await prisma.user.findUnique({
      where: { id: user.id },
      select: { premiumTrialUntil: true },
    })
    expect(after?.premiumTrialUntil).toBeTruthy()
    if (after?.premiumTrialUntil) {
      const roughlyThreeMonthsMs = 80 * 86400000
      const span = after.premiumTrialUntil.getTime() - Date.now()
      expect(span).toBeGreaterThan(roughlyThreeMonthsMs - 86400000)
      expect(span).toBeLessThan(roughlyThreeMonthsMs + 86400000 * 15)
    }

    const ref = await prisma.referral.findUnique({ where: { refereeId: user.id } })
    expect(ref?.status).toBe("activated")

    await prisma.user.delete({ where: { id: user.id } })
  })

  test("activateReferral — 1 month trial when referrer is free tier", async () => {
    const email = `e2e-referee-free-act-${Date.now()}@bitbudget.test`
    const user = await prisma.user.create({
      data: { email, name: "E2E Free Act", subscriptionTier: "free", onboardingComplete: false },
    })

    const r = await redeemReferralCode({
      refereeId: user.id,
      rawCode: E2E_USER_CODE_FREE_REFERRER,
      shareMethod: "e2e",
    })
    expect(r.ok).toBe(true)

    const act = await activateReferral(user.id)
    expect(act.didActivate).toBe(true)
    expect(act.refereeTrialMonths).toBe(1)

    const after = await prisma.user.findUnique({
      where: { id: user.id },
      select: { premiumTrialUntil: true },
    })
    expect(after?.premiumTrialUntil).toBeTruthy()
    if (after?.premiumTrialUntil) {
      const span = after.premiumTrialUntil.getTime() - Date.now()
      expect(span).toBeGreaterThan(25 * 86400000)
      expect(span).toBeLessThan(40 * 86400000)
    }

    await prisma.user.delete({ where: { id: user.id } })
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
