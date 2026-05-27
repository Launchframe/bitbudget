import type { Page } from "@playwright/test"
import { PRIVACY_KEY_CACHE_TTL_MS } from "@/lib/privacy-key-storage"
import {
  E2E_TEST_PASSPHRASE,
  E2E_TEST_PRIVACY_KEY_HEX,
} from "../fixtures/encryption-e2e-constants"

/** Prime localStorage privacy key cache (7-day TTL) for a seeded user. */
export async function primePrivacyKeyCache(page: Page, userId: string): Promise<void> {
  const expiresAt = Date.now() + PRIVACY_KEY_CACHE_TTL_MS
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
  const pinInput = page.getByPlaceholder("Enter your passphrase")

  const visibleTarget = await Promise.any([
    pinInput.waitFor({ state: "visible", timeout: 30_000 }).then(() => "pin" as const),
    appShellLocator(page).waitFor({ state: "visible", timeout: 30_000 }).then(() => "shell" as const),
  ]).catch(() => null)

  if (visibleTarget === "pin") {
    await pinInput.fill(E2E_TEST_PASSPHRASE)
    await page.getByRole("button", { name: "Unlock" }).click()
    await expectAppShell(page)
    return
  }

  await expectAppShell(page)
}

function appShellLocator(page: Page) {
  const width = page.viewportSize()?.width ?? 1280
  return width < 768
    ? page.getByRole("button", { name: "Home" })
    : page.getByRole("button", { name: "TRANSACTIONS" })
}

async function expectAppShell(page: Page): Promise<void> {
  await appShellLocator(page).waitFor({ state: "visible", timeout: 90_000 })
}

export { expectAppShell }
