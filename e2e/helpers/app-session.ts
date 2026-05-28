import type { Page } from "@playwright/test"
import { signInWithE2eEmail } from "./auth-email"
import { fetchJsonInPage } from "./fetch-json"
import { primePrivacyKeyCache, unlockPassphraseIfNeeded, expectAppShell } from "./privacy-cache"
import { dismissWalkthroughIfPresent } from "./shell"

export async function signInAppUser(page: Page, origin: string, email: string): Promise<string> {
  await signInWithE2eEmail(page, origin, email)
  await page.goto(`${origin}/#/dashboard`)
  const enc = await fetchJsonInPage(page, "/api/user/encryption")
  const userId = typeof enc.json?.userId === "string" ? enc.json.userId : ""
  if (!userId) throw new Error("Could not resolve userId from /api/user/encryption")
  await unlockPassphraseIfNeeded(page)
  await primePrivacyKeyCache(page, userId)
  await page.reload()
  await expectAppShell(page)
  await dismissWalkthroughIfPresent(page)
  return userId
}
