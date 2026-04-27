import type { Page } from "@playwright/test"

/**
 * Use the browser's fetch + cookies; Playwright's APIRequestContext is separate
 * from the app session established by email OTP sign-in.
 */
export async function fetchJsonInPage<TJson = Record<string, unknown>>(
  page: Page,
  path: string,
  init: { method?: string; body?: Record<string, unknown> } = {},
): Promise<{ status: number; json: TJson | null }> {
  const method = init.method ?? "GET"
  const body = init.body
  return page.evaluate(
    async ({ path: p, method: m, body: b }) => {
      const r = await fetch(p, {
        method: m,
        headers: b ? { "Content-Type": "application/json" } : undefined,
        credentials: "include",
        body: b ? JSON.stringify(b) : undefined,
      })
      const text = await r.text()
      let json: unknown = null
      try {
        json = text ? JSON.parse(text) : null
      } catch {
        json = { _parseError: true, _raw: text.slice(0, 200) }
      }
      return { status: r.status, json }
    },
    { path, method, body },
  ) as Promise<{ status: number; json: TJson | null }>
}
