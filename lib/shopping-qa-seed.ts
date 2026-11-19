/** Emails `pnpm qa:shopping:seed` is allowed to delete and recreate. */
export const SHOPPING_QA_SEED_EMAILS = {
  owner: "shopping-owner@bitbudget.test",
  member: "shopping-member@bitbudget.test",
} as const

const ALLOWED = new Set<string>(Object.values(SHOPPING_QA_SEED_EMAILS))

/**
 * Fail closed before any delete. A `@bitbudget.test` suffix is not enough:
 * other fixtures (e2e users) share that domain.
 */
export function assertShoppingQaSeedEmail(email: string): void {
  if (!ALLOWED.has(email)) {
    throw new Error("Refusing qa:shopping:seed: email is not an allowlisted shopping QA account")
  }
}
