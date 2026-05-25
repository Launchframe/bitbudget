import type { Page } from "@playwright/test"
import {
  E2E_TEST_PASSPHRASE,
  E2E_TEST_PRIVACY_KEY_HEX,
} from "../fixtures/encryption-e2e-constants"

/** Prime localStorage privacy key cache (7-day TTL) for a seeded user. */
export async function primePrivacyKeyCache(page: Page, userId: string): Promise<void> {
  const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000
  await page.evaluate(
    ({ userId: uid, hexKey, expiresAtMs }) => {
      localStorage.setItem("bitbudget-privacy-key", hexKey)
      localStorage.setItem("bitbudget-privacy-user", uid)
      localStorage.setItem("bitbudget-privacy-unlock-expires", String(expiresAtMs))
    },
    { userId, hexKey: E2E_TEST_PRIVACY_KEY_HEX, expiresAtMs: expiresAt },
  )
}

/** Unlock PIN dialog when cache is missing but server has wrapped key. */
export async function unlockPassphraseIfNeeded(page: Page): Promise<void> {
  const dialog = page.getByRole("dialog").filter({ hasText: "Unlock" })
  const pinInput = page.getByPlaceholder("Enter your passphrase")
  if (await pinInput.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await pinInput.fill(E2E_TEST_PASSPHRASE)
    await page.getByRole("button", { name: "Unlock" }).click()
    await expectAppShell(page)
  }
}

async function expectAppShell(page: import("@playwright/test").Page): Promise<void> {
  const width = page.viewportSize()?.width ?? 1280
  if (width < 768) {
    await page.getByRole("button", { name: "Home" }).waitFor({ state: "visible", timeout: 90_000 })
  } else {
    await page.getByRole("button", { name: "TRANSACTIONS" }).waitFor({ state: "visible", timeout: 90_000 })
  }
}

export { expectAppShell }
