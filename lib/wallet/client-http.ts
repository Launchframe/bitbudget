export class WalletClientError extends Error {
  constructor(readonly code: string) {
    super(code)
    this.name = "WalletClientError"
  }
}

export async function walletRequest(path: string, body?: unknown, signal?: AbortSignal): Promise<unknown> {
  if (!/^\/api\/wallets(?:\/[a-zA-Z0-9/-]+)?$/.test(path)) throw new WalletClientError("invalid-wallet-request")
  let response: Response
  try {
    const url = typeof location === "undefined" ? path : new URL(path, location.origin).href
    response = await fetch(url, {
      method: body === undefined ? "GET" : "POST",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin", cache: "no-store", redirect: "error", signal,
    })
  } catch {
    throw new WalletClientError(signal?.aborted ? "setup-cancelled" : "wallet-service-unavailable")
  }
  if (!response.body || response.headers.get("content-type")?.split(";")[0] !== "application/json") throw new WalletClientError("wallet-service-unavailable")
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let size = 0
  let text = ""
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > 262_144) {
        await reader.cancel()
        throw new WalletClientError("wallet-response-too-large")
      }
      text += decoder.decode(value, { stream: true })
    }
    text += decoder.decode()
  } finally {
    reader.releaseLock()
  }
  let result: unknown
  try { result = JSON.parse(text) } catch { throw new WalletClientError("wallet-service-unavailable") }
  if (!response.ok) {
    const error = result && typeof result === "object" && "error" in result ? result.error : null
    const code = error && typeof error === "object" && "code" in error && typeof error.code === "string" && /^[a-z-]{1,64}$/.test(error.code) ? error.code : "wallet-service-unavailable"
    throw new WalletClientError(code)
  }
  return result
}
