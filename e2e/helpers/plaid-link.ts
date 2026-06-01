import { expect, type Page } from "@playwright/test"

/** Plaid sandbox credentials — see https://plaid.com/docs/sandbox/test-credentials/ */
export const PLAID_SANDBOX_USERNAME = "user_good"
export const PLAID_SANDBOX_PASSWORD = "pass_good"

export function isPlaidSandboxConfigured(): boolean {
  const clientId = process.env.PLAID_CLIENT_ID?.trim()
  const secret = process.env.PLAID_SECRET?.trim()
  if (!clientId || !secret) return false
  const env = (process.env.PLAID_ENV ?? "sandbox").trim().toLowerCase()
  return env === "sandbox" || env === "development"
}

function plaidLinkFrame(page: Page) {
  return page
    .frameLocator('iframe[title="Plaid Link"], iframe[src*="cdn.plaid.com"]')
    .first()
}

async function clickFirstMatchingButton(
  page: Page,
  name: RegExp,
  timeoutMs = 12_000,
): Promise<boolean> {
  const frame = plaidLinkFrame(page)
  const btn = frame.getByRole("button", { name }).first()
  try {
    await btn.waitFor({ state: "visible", timeout: timeoutMs })
    await btn.click()
    return true
  } catch {
    return false
  }
}

/**
 * Complete Plaid Link in sandbox using `user_good` / `pass_good`.
 * Caller must click **Connect bank** first and wait for the Link iframe to open.
 */
export async function completePlaidLinkSandbox(page: Page): Promise<void> {
  const frame = plaidLinkFrame(page)
  await frame.locator("body").waitFor({ state: "attached", timeout: 60_000 })

  await clickFirstMatchingButton(page, /continue as guest|continue without phone/i)
  await clickFirstMatchingButton(page, /^continue$/i)

  const search = frame.getByRole("textbox", { name: /search/i })
  const searchVisible = await search.isVisible({ timeout: 15_000 }).catch(() => false)

  if (searchVisible) {
    await search.fill("First Platypus Bank")
    await search.press("Enter")
    const institution = frame.getByRole("button", { name: /First Platypus Bank/i })
    await institution.waitFor({ state: "visible", timeout: 30_000 })
    await institution.click()
  } else {
    await frame.getByRole("button", { name: /First Platypus Bank/i }).first().click({ timeout: 20_000 })
  }

  const username = frame
    .getByLabel(/username|user id/i)
    .or(frame.locator('input[name="username"]'))
    .first()
  await username.waitFor({ state: "visible", timeout: 30_000 })
  await username.fill(PLAID_SANDBOX_USERNAME)

  const password = frame
    .getByLabel(/password/i)
    .or(frame.locator('input[type="password"]'))
    .first()
  await password.fill(PLAID_SANDBOX_PASSWORD)

  await clickFirstMatchingButton(page, /submit|sign in|log in/i)

  await clickFirstMatchingButton(page, /continue/i, 20_000)
  await clickFirstMatchingButton(page, /connect account|connect|finish|allow/i, 20_000)
}

export async function expectPlaidConnectSuccessDialog(page: Page): Promise<void> {
  await expect(
    page.getByRole("dialog").filter({ hasText: /successfully connected/i }),
  ).toBeVisible({ timeout: 90_000 })
}

export async function openSettingsIntegrations(page: Page, origin: string): Promise<void> {
  await page.goto(`${origin}/#/settings/integrations`)
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible({ timeout: 90_000 })
  await expect(page.getByRole("button", { name: "Connect bank" })).toBeVisible({ timeout: 30_000 })
}

export function expectPremiumTrialSpanDays(untilIso: string, expectedMonths: 1 | 3): void {
  const spanDays = (Date.parse(untilIso) - Date.now()) / 86400000
  if (expectedMonths === 3) {
    expect(spanDays).toBeGreaterThan(79)
    expect(spanDays).toBeLessThan(95)
  } else {
    expect(spanDays).toBeGreaterThan(25)
    expect(spanDays).toBeLessThan(40)
  }
}
