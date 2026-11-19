import { NextResponse } from "next/server"
import { isShoppingCiphertext } from "@/lib/shopping-crypto"
import {
  SHOPPING_MAX_CIPHERTEXT_CHARS,
  isNonEmptyId,
} from "@/lib/shopping-types"

export function shoppingJson(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "no-store, private" },
  })
}

export async function readShoppingJson(req: Request): Promise<
  { ok: true; body: Record<string, unknown> } | { ok: false; response: NextResponse }
> {
  try {
    const parsed: unknown = await req.json()
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false, response: shoppingJson({ error: "Invalid JSON" }, 400) }
    }
    return { ok: true, body: parsed as Record<string, unknown> }
  } catch {
    return { ok: false, response: shoppingJson({ error: "Invalid JSON" }, 400) }
  }
}

export function requireShoppingId(value: unknown): string | null {
  if (!isNonEmptyId(value)) return null
  return value.trim()
}

export function requireShoppingCiphertext(value: unknown, label: string): string | NextResponse {
  if (typeof value !== "string" || value.length === 0) {
    return shoppingJson({ error: `${label} is required` }, 400)
  }
  if (value.length > SHOPPING_MAX_CIPHERTEXT_CHARS) {
    return shoppingJson({ error: `${label} is too large` }, 400)
  }
  if (!isShoppingCiphertext(value)) {
    return shoppingJson({ error: `${label} must be encrypted` }, 400)
  }
  return value
}

export function requirePositiveInt(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) return null
  return value
}
