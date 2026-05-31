import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import {
  createManualDeficitCover,
  type ManualDeficitCoverEntry,
} from "@/lib/envelope-sweep"

export function parseEntries(body: unknown): ManualDeficitCoverEntry[] | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null
  const { entries } = body as { entries?: unknown }
  if (!Array.isArray(entries)) return null

  const parsed: ManualDeficitCoverEntry[] = []
  for (const row of entries) {
    if (typeof row !== "object" || row === null || Array.isArray(row)) return null
    const { envelopeId, amount } = row as { envelopeId?: unknown; amount?: unknown }
    if (typeof envelopeId !== "string" || envelopeId.trim().length === 0) return null
    const amountNum = typeof amount === "number" ? amount : Number(amount)
    if (!Number.isFinite(amountNum) || amountNum <= 0) return null
    parsed.push({ envelopeId: envelopeId.trim(), amount: amountNum })
  }
  return parsed.length > 0 ? parsed : null
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const entries = parseEntries(body)
  if (!entries) {
    return NextResponse.json(
      { error: "entries must be a non-empty array of { envelopeId, amount }" },
      { status: 400 },
    )
  }

  const created = await createManualDeficitCover(session.user.id, entries)
  if (created <= 0) {
    return NextResponse.json(
      {
        error:
          "Could not cover from Savings. The envelope may not be overdrawn this month, or Savings may not have enough.",
      },
      { status: 400 },
    )
  }

  return NextResponse.json({ ok: true, created })
}
