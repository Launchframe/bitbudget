import { expect, type Frame, type Page } from "@playwright/test"

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

async function clickFirstMatchingButtonInFrame(
  frame: Frame,
  name: RegExp,
  timeoutMs = 12_000,
): Promise<boolean> {
  const btn = frame.getByRole("button", { name }).first()
  try {
    await btn.waitFor({ state: "visible", timeout: timeoutMs })
    await btn.click()
    return true
  } catch {
    return false
  }
}

/** Plaid Link may nest iframes; locate the frame that actually renders Link UI. */
async function waitForPlaidUiFrame(page: Page, predicate: (frame: Frame) => Promise<boolean>): Promise<Frame> {
  await page.locator('iframe[title="Plaid Link"]').waitFor({ state: "attached", timeout: 60_000 })
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    for (const frame of page.frames()) {
      if (frame === page.mainFrame()) continue
      if (await predicate(frame).catch(() => false)) return frame
    }
    await page.waitForTimeout(300)
  }
  throw new Error("Plaid Link UI frame not found")
}

async function dismissPlaidPreflight(frame: Frame): Promise<void> {
  await clickFirstMatchingButtonInFrame(frame, /continue as guest|continue without phone/i, 3_000)
  await clickFirstMatchingButtonInFrame(frame, /^continue$/i, 3_000)
}

async function findPlaidSearchFrame(page: Page): Promise<Frame> {
  for (let attempt = 0; attempt < 40; attempt++) {
    for (const frame of page.frames()) {
      if (frame === page.mainFrame()) continue
      await dismissPlaidPreflight(frame)
    }
    try {
      return await waitForPlaidUiFrame(page, async (frame) => {
        const search = frame
          .getByRole("textbox", { name: /search/i })
          .or(frame.getByPlaceholder(/search/i))
          .or(frame.locator('input[type="search"]'))
        return search.first().isVisible()
      })
    } catch {
      await page.waitForTimeout(500)
    }
  }
  throw new Error("Plaid Link institution search not found")
}

/**
 * Complete Plaid Link in sandbox using `user_good` / `pass_good`.
 * Caller must click **Connect bank** first and wait for the Link iframe to open.
 */
export async function completePlaidLinkSandbox(page: Page): Promise<void> {
  const pickerFrame = await findPlaidSearchFrame(page)

  const search = pickerFrame
    .getByRole("textbox", { name: /search/i })
    .or(pickerFrame.getByPlaceholder(/search/i))
    .or(pickerFrame.locator('input[type="search"]'))

  await search.first().fill("First Platypus Bank")

  const institution = pickerFrame.getByRole("button", { name: /First Platypus Bank/i })
  await expect(institution).toBeVisible({ timeout: 45_000 })
  await institution.click()

  const credentialsFrame = await waitForPlaidUiFrame(page, async (frame) => {
    const username = frame
      .getByLabel(/username|user id/i)
      .or(frame.locator('input[name="username"]'))
    return username.first().isVisible()
  })

  const username = credentialsFrame
    .getByLabel(/username|user id/i)
    .or(credentialsFrame.locator('input[name="username"]'))
    .first()
  await username.fill(PLAID_SANDBOX_USERNAME)

  const password = credentialsFrame
    .getByLabel(/password/i)
    .or(credentialsFrame.locator('input[type="password"]'))
    .first()
  await password.fill(PLAID_SANDBOX_PASSWORD)

  await clickFirstMatchingButtonInFrame(credentialsFrame, /submit|sign in|log in/i)
  await clickFirstMatchingButtonInFrame(credentialsFrame, /continue/i, 20_000)
  await clickFirstMatchingButtonInFrame(
    credentialsFrame,
    /connect account|connect|finish|allow/i,
    20_000,
  )
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
