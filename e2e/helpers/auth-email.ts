import type { Page } from "@playwright/test"
import { E2E_EMAIL_CODE } from "../fixtures/referral-e2e-constants"

/**
 * Sign in via Email OTP using E2E_TEST send-code bypass (@bitbudget.test + E2E_EMAIL_CODE).
 */
export async function signInWithE2eEmail(page: Page, baseURL: string, email: string): Promise<void> {
  await page.goto(`${baseURL}/auth`)
  await page.getByRole("button", { name: "Email" }).click()
  await page.getByPlaceholder("you@example.com").fill(email)
  await page.getByRole("button", { name: "Send Login Code" }).click()
  await page.getByPlaceholder("000000").waitFor({ state: "visible", timeout: 15_000 })
  await page.getByPlaceholder("000000").fill(E2E_EMAIL_CODE)
  await page.getByRole("button", { name: "Continue" }).click()
  await page.waitForURL(url => !url.pathname.startsWith("/auth"), { timeout: 30_000 })
}
