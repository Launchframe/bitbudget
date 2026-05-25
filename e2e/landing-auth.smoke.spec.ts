import "./load-env"
import { test, expect } from "@playwright/test"
import { deleteE2eUserByEmail } from "./helpers/e2e-user"
import { onboardingTestEmail } from "./fixtures/onboarding-e2e-constants"
import { signInWithE2eEmail } from "./helpers/auth-email"

test.describe("Landing and auth smoke", () => {
  test("welcome Get Started reaches auth", async ({ page, baseURL }) => {
    const origin = baseURL?.replace(/\/$/, "") ?? "http://127.0.0.1:3100"
    await page.goto(`${origin}/welcome`)
    await page.locator("header").getByRole("button", { name: "Get Started" }).click()
    await expect(page).toHaveURL(/\/auth/)
    await expect(page.getByRole("button", { name: "Email" })).toBeVisible()
  })

  test("fresh email sign-in redirects to onboarding", async ({ page, baseURL, request }) => {
    const origin = baseURL?.replace(/\/$/, "") ?? "http://127.0.0.1:3100"
    const email = onboardingTestEmail("landing-fresh")
    await deleteE2eUserByEmail(request, origin, email)

    await page.addInitScript(() => {
      sessionStorage.setItem("onboardingSource", "vanilla")
    })
    await signInWithE2eEmail(page, origin, email)
    await page.waitForURL(/\/(onboarding)?/, { timeout: 30_000 })
    const onOnboarding =
      page.url().includes("/onboarding") ||
      (await page.getByRole("heading", { name: "Have a referral code?" }).isVisible({ timeout: 5_000 }).catch(() => false))
    if (!onOnboarding) {
      await page.goto(`${origin}/`)
      await page.waitForURL(/\/onboarding/, { timeout: 15_000 })
    }
    await expect(page.getByRole("heading", { name: "Have a referral code?" })).toBeVisible({
      timeout: 30_000,
    })
  })
})
