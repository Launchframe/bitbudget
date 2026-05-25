import "./load-env"
import { test, expect } from "@playwright/test"
import { prisma } from "../lib/db"
import {
  E2E_TEST_ENCRYPTED_PRIVACY_KEY_JSON,
  E2E_TEST_PRIVACY_KEY_SALT_HEX,
} from "./fixtures/encryption-e2e-constants"
import { signInWithE2eEmail } from "./helpers/auth-email"
import { primePrivacyKeyCache } from "./helpers/privacy-cache"

/**
 * Regression: walkthrough completion must be per-user (DB), not browser localStorage.
 */
test.describe("Dashboard walkthrough", () => {
  test("completion is per-user and persists after reload", async ({ page, baseURL }) => {
    const origin = baseURL?.replace(/\/$/, "") ?? "http://127.0.0.1:3100"
    const emailA = `e2e-walkthrough-a-${Date.now()}@bitbudget.test`
    const emailB = `e2e-walkthrough-b-${Date.now()}@bitbudget.test`

    const skipWalkthrough = page.getByRole("button", { name: "Skip walkthrough" })

    async function signInReadyForWalkthrough(email: string) {
      await page.context().clearCookies()
      await signInWithE2eEmail(page, origin, email)
      const user = await prisma.user.findUnique({
        where: { email },
        select: { id: true },
      })
      expect(user?.id).toBeTruthy()
      await prisma.user.update({
        where: { id: user!.id },
        data: {
          onboardingComplete: true,
          walkthroughCompleted: false,
          monthlyIncome: 5000,
          encryptedPrivacyKey: E2E_TEST_ENCRYPTED_PRIVACY_KEY_JSON,
          privacyKeySalt: E2E_TEST_PRIVACY_KEY_SALT_HEX,
        },
      })
      await page.goto(`${origin}/#/dashboard`)
      await primePrivacyKeyCache(page, user!.id)
      await page.reload()
      await expect(page.getByText("Monthly Income")).toBeVisible({ timeout: 90_000 })
    }

    async function dismissWalkthroughAndWaitForSave() {
      const putPromise = page.waitForResponse(
        (res) => {
          if (!res.url().includes("/api/user/settings") || res.request().method() !== "PUT") {
            return false
          }
          try {
            const body = res.request().postDataJSON() as { walkthroughCompleted?: boolean }
            return body.walkthroughCompleted === true
          } catch {
            return false
          }
        },
        { timeout: 15_000 },
      )
      await skipWalkthrough.click()
      const res = await putPromise
      expect(res.ok(), `walkthrough PUT failed: ${res.status()} ${await res.text()}`).toBeTruthy()
      await expect(skipWalkthrough).not.toBeVisible()
    }

    await signInReadyForWalkthrough(emailA)
    await expect(skipWalkthrough).toBeVisible({ timeout: 20_000 })
    await dismissWalkthroughAndWaitForSave()

    await expect
      .poll(async () => {
        const user = await prisma.user.findUnique({
          where: { email: emailA },
          select: { walkthroughCompleted: true },
        })
        return user?.walkthroughCompleted
      })
      .toBe(true)

    await signInReadyForWalkthrough(emailB)
    await expect(skipWalkthrough).toBeVisible({ timeout: 20_000 })
    await dismissWalkthroughAndWaitForSave()

    await page.reload()
    await expect(page.getByText("Monthly Income")).toBeVisible({ timeout: 90_000 })
    await expect(skipWalkthrough).not.toBeVisible({ timeout: 5_000 })

    await expect
      .poll(async () => {
        const user = await prisma.user.findUnique({
          where: { email: emailB },
          select: { walkthroughCompleted: true },
        })
        return user?.walkthroughCompleted
      })
      .toBe(true)
  })
})
