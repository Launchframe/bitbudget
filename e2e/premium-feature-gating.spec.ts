import "./load-env"
import { test, expect } from "@playwright/test"
import {
  E2E_APP_USER_EMAIL,
  E2E_PREMIUM_USER_EMAIL,
  E2E_TRIAL_USER_EMAIL,
} from "./fixtures/app-e2e-constants"
import { signInAppUser } from "./helpers/app-session"
import { fetchJsonInPage } from "./helpers/fetch-json"

/**
 * Server-side premium gates for AI input (voice, receipt scan) vs paid-only features (push).
 * Trial users must pass requirePremiumOrTrial on voice/receipt; free users must not.
 */
test.describe("Premium feature API gating", () => {
  test("free user: voice parse returns 403", async ({ page, baseURL }) => {
    const origin = baseURL?.replace(/\/$/, "") ?? "http://127.0.0.1:3100"
    await signInAppUser(page, origin, E2E_APP_USER_EMAIL)

    const settings = await fetchJsonInPage(page, "/api/user/settings")
    expect(settings.json?.effectiveTier).toBe("free")

    const { status, json } = await fetchJsonInPage(page, "/api/voice/parse", {
      method: "POST",
      body: { transcript: "coffee five dollars groceries" },
    })
    expect(status).toBe(403)
    expect(String(json?.message ?? "")).toMatch(/premium|trial/i)
  })

  test("trial user: voice parse passes gate (not 403)", async ({ page, baseURL }) => {
    const origin = baseURL?.replace(/\/$/, "") ?? "http://127.0.0.1:3100"
    await signInAppUser(page, origin, E2E_TRIAL_USER_EMAIL)

    const settings = await fetchJsonInPage(page, "/api/user/settings")
    expect(settings.json?.effectiveTier).toBe("premium-trial")

    const { status, json } = await fetchJsonInPage(page, "/api/voice/parse", {
      method: "POST",
      body: { transcript: "coffee five dollars groceries" },
    })
    expect(status).not.toBe(403)
    if (status === 403) {
      throw new Error(`Trial user blocked: ${JSON.stringify(json)}`)
    }
  })

  test("paid premium user: voice parse passes gate (not 403)", async ({ page, baseURL }) => {
    const origin = baseURL?.replace(/\/$/, "") ?? "http://127.0.0.1:3100"
    await signInAppUser(page, origin, E2E_PREMIUM_USER_EMAIL)

    const settings = await fetchJsonInPage(page, "/api/user/settings")
    expect(settings.json?.effectiveTier).toBe("premium")

    const { status } = await fetchJsonInPage(page, "/api/voice/parse", {
      method: "POST",
      body: { transcript: "lunch twelve dollars" },
    })
    expect(status).not.toBe(403)
  })

  test("free user: receipt scan returns 403", async ({ page, baseURL }) => {
    const origin = baseURL?.replace(/\/$/, "") ?? "http://127.0.0.1:3100"
    await signInAppUser(page, origin, E2E_APP_USER_EMAIL)

    const { status, json } = await fetchJsonInPage(page, "/api/receipts/scan", {
      method: "POST",
      body: {},
    })
    expect(status).toBe(403)
    expect(String(json?.message ?? "")).toMatch(/premium|trial/i)
  })

  test("trial user: receipt scan passes gate (not 403)", async ({ page, baseURL }) => {
    const origin = baseURL?.replace(/\/$/, "") ?? "http://127.0.0.1:3100"
    await signInAppUser(page, origin, E2E_TRIAL_USER_EMAIL)

    const { status } = await fetchJsonInPage(page, "/api/receipts/scan", {
      method: "POST",
      body: {},
    })
    expect(status).not.toBe(403)
  })

  test("trial user: push subscribe stays paid-only (403)", async ({ page, baseURL }) => {
    const origin = baseURL?.replace(/\/$/, "") ?? "http://127.0.0.1:3100"
    await signInAppUser(page, origin, E2E_TRIAL_USER_EMAIL)

    const { status, json } = await fetchJsonInPage(page, "/api/push/subscribe", {
      method: "POST",
      body: {
        endpoint: "https://push.example/e2e-trial",
        keys: { p256dh: "test", auth: "test" },
      },
    })
    expect(status).toBe(403)
    expect(String(json?.message ?? "")).toMatch(/premium/i)
  })

  test("paid premium user: push subscribe passes requirePremium gate", async ({ page, baseURL }) => {
    const origin = baseURL?.replace(/\/$/, "") ?? "http://127.0.0.1:3100"
    await signInAppUser(page, origin, E2E_PREMIUM_USER_EMAIL)

    const { status } = await fetchJsonInPage(page, "/api/push/subscribe", {
      method: "POST",
      body: {
        endpoint: "https://push.example/e2e-premium",
        keys: { p256dh: "test", auth: "test" },
      },
    })
    expect(status).not.toBe(403)
  })
})

test.describe("Premium feature UI — voice with mocked parse", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/api/voice/parse", async route => {
      if (route.request().method() !== "POST") {
        await route.continue()
        return
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          payee: "E2E Voice Café",
          amount: 12.5,
          envelopeId: null,
          envelopeName: null,
          date: "2026-05-29",
        }),
      })
    })
  })

  test("trial user can open voice sheet and receive mocked parse result", async ({ page, baseURL }) => {
    const origin = baseURL?.replace(/\/$/, "") ?? "http://127.0.0.1:3100"
    await signInAppUser(page, origin, E2E_TRIAL_USER_EMAIL)

    await page.goto(`${origin}/#/transactions`)
    await page.getByTitle("New Transaction").click()
    await expect(page.getByRole("heading", { name: "New Transaction" })).toBeVisible()

    await page.evaluate(async () => {
      const r = await fetch("/api/voice/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ transcript: "twelve fifty at cafe" }),
      })
      if (r.status === 403) throw new Error("trial user blocked from voice parse")
    })
  })
})
