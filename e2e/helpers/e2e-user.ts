import type { APIRequestContext } from "@playwright/test"

export async function deleteE2eUserByEmail(
  request: APIRequestContext,
  baseURL: string,
  email: string,
): Promise<void> {
  const origin = baseURL.replace(/\/$/, "")
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  const token = process.env.E2E_API_TOKEN?.trim()
  if (token) headers["x-e2e-api-token"] = token

  const res = await request.post(`${origin}/api/e2e/delete-user`, {
    headers,
    data: { email },
  })
  if (!res.ok() && res.status() !== 404) {
    const text = await res.text()
    throw new Error(`delete-user failed (${res.status()}): ${text}`)
  }
}
