import { NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { walletConfig, WalletError } from "@/lib/wallet/server/config"

export async function walletUser(): Promise<string> {
  const session = await auth()
  if (!session?.user?.id) throw new WalletError(401, "unauthorized")
  return session.user.id
}

export function requireWalletOrigin(request: Request): string {
  const { origins } = walletConfig()
  const origin = request.headers.get("origin")
  if (!origin || !origins.includes(origin) || request.headers.get("sec-fetch-site") === "cross-site") {
    throw new WalletError(403, "origin-rejected")
  }
  return origin
}

export async function walletBody<T extends z.ZodTypeAny>(request: Request, schema: T): Promise<z.infer<T>> {
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") {
    throw new WalletError(415, "json-required")
  }
  if (request.headers.get("content-encoding") && request.headers.get("content-encoding") !== "identity") {
    throw new WalletError(415, "encoding-rejected")
  }
  const maximum = 32768
  const declared = request.headers.get("content-length")
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > maximum)) throw new WalletError(413, "body-too-large")
  if (!request.body) throw new WalletError(400, "invalid-request")
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > maximum) {
        await reader.cancel()
        throw new WalletError(413, "body-too-large")
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  try {
    return schema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")))
  } catch {
    throw new WalletError(400, "invalid-request")
  }
}

export function walletJson(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store", "Vary": "Cookie, Origin" } })
}

export async function walletRoute(action: () => Promise<unknown>) {
  try {
    return walletJson(await action())
  } catch (error) {
    if (error instanceof WalletError) return walletJson({ error: { code: error.code } }, error.status)
    return walletJson({ error: { code: "wallet-service-unavailable" } }, 503)
  }
}
