import "./load-env"
import { test, expect } from "@playwright/test"
import { prisma } from "../lib/db"
import { signInWithE2eEmail } from "./helpers/auth-email"

/**
 * Regression: walkthrough completion must be per-user (DB), not browser localStorage.
 */
test.describe("Dashboard walkthrough", () => {
  test("completion is per-user and persists after reload", async ({ page, baseURL }) => {
    const origin = baseURL?.replace(/\/$/, "") ?? "http://127.0.0.1:3100"
    const emailA = `e2e-walkthrough-a-${Date.now()}@bitbudget.test`
    const emailB = `e2e-walkthrough-b-${Date.now()}@bitbudget.test`

    async function signInReadyForWalkthrough(email: string) {
      await signInWithE2eEmail(page, origin, email)
      const user = await prisma.user.findUnique({
        where: { email },
        select: { id: true },
      })
      expect(user?.id).toBeTruthy()
      await prisma.user.update({
        where: { id: user!.id },
        data: { onboardingComplete: true, walkthroughCompleted: false },
      })
      await page.goto(`${origin}/#/dashboard`)
      await expect(page.getByText("Monthly Income")).toBeVisible({ timeout: 90_000 })
    }

    const skipWalkthrough = page.getByRole("button", { name: "Skip walkthrough" })

    await signInReadyForWalkthrough(emailA)
    await expect(skipWalkthrough).toBeVisible({ timeout: 15_000 })
    await skipWalkthrough.click()
    await expect(skipWalkthrough).not.toBeVisible()

    const userA = await prisma.user.findUnique({
      where: { email: emailA },
      select: { walkthroughCompleted: true },
    })
    expect(userA?.walkthroughCompleted).toBe(true)

    await signInReadyForWalkthrough(emailB)
    await expect(skipWalkthrough).toBeVisible({ timeout: 15_000 })
    await skipWalkthrough.click()
    await expect(skipWalkthrough).not.toBeVisible()

    await page.reload()
    await expect(page.getByText("Monthly Income")).toBeVisible({ timeout: 90_000 })
    await expect(skipWalkthrough).not.toBeVisible({ timeout: 5_000 })

    const userB = await prisma.user.findUnique({
      where: { email: emailB },
      select: { walkthroughCompleted: true },
    })
    expect(userB?.walkthroughCompleted).toBe(true)
  })
})
