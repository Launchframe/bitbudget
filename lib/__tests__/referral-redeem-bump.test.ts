// @vitest-environment node
/**
 * Referral redeem uses a raw SQL bump with UTC-normalized date comparisons.
 * Without `AT TIME ZONE 'UTC'`, Postgres interprets naive `startsAt`/`expiresAt`
 * in the session timezone while JS validation uses UTC — validation passes but
 * the bump updates 0 rows → false 410 "expired or exhausted".
 */
import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import path from "node:path"

describe("referral redeem bump SQL", () => {
  it("compares ReferralCode dates as UTC in raw UPDATE", () => {
    const src = readFileSync(path.join(process.cwd(), "lib/referral.ts"), "utf8")
    expect(src).toMatch(/"startsAt" AT TIME ZONE 'UTC'\) <= \$\{now\}/)
    expect(src).toMatch(/"expiresAt" AT TIME ZONE 'UTC'\) > \$\{now\}/)
  })
})
