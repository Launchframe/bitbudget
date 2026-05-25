import type { Page } from "@playwright/test"

export async function fetchJsonInPage(
  page: Page,
  path: string,
  init: { method?: string; body?: Record<string, unknown> } = {},
): Promise<{ status: number; json: Record<string, unknown> | null }> {
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
      let json: Record<string, unknown> | null = null
      try {
        json = text ? (JSON.parse(text) as Record<string, unknown>) : null
      } catch {
        json = { _parseError: true, _raw: text.slice(0, 200) }
      }
      return { status: r.status, json }
    },
    { path, method, body },
  )
}
