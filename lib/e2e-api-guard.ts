/**
 * Shared guards for test-only API routes (`/api/e2e/*`).
 * Never enable `E2E_TEST` in production.
 */

export function isE2eTestApiEnabled(): boolean {
  if (process.env.E2E_TEST !== "true") return false
  // Playwright runs `next start` (NODE_ENV=production) with E2E_TEST=true — do not gate on NODE_ENV.
  if (process.env.VERCEL_ENV === "production") return false
  return true
}

/** When `E2E_API_TOKEN` is set, callers must send `x-e2e-api-token` with the same value. */
export function isE2eApiTokenValid(req: Request): boolean {
  const expected = process.env.E2E_API_TOKEN?.trim()
  if (!expected) return true
  const provided = req.headers.get("x-e2e-api-token")?.trim()
  return provided === expected
}
