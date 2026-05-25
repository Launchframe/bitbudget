import type { APIRequestContext } from "@playwright/test"

export async function deleteE2eUserByEmail(
  request: APIRequestContext,
  baseURL: string,
  email: string,
): Promise<void> {
  const origin = baseURL.replace(/\/$/, "")
  const res = await request.post(`${origin}/api/e2e/delete-user`, {
    headers: { "Content-Type": "application/json" },
    data: { email },
  })
  if (!res.ok() && res.status() !== 404) {
    const text = await res.text()
    throw new Error(`delete-user failed (${res.status()}): ${text}`)
  }
}
