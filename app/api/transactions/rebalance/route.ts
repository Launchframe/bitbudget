import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import {
  createRebalanceBatch,
  type RebalanceEntry,
  type RebalanceMode,
} from "@/lib/rebalance-envelopes"

export function parseBody(
  body: unknown,
): { entries: RebalanceEntry[]; mode: RebalanceMode; config?: unknown } | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null
  const { entries, mode, config } = body as {
    entries?: unknown
    mode?: unknown
    config?: unknown
  }
  if (mode !== "balanced" && mode !== "independent") return null
  if (!Array.isArray(entries)) return null

  const parsed: RebalanceEntry[] = []
  for (const row of entries) {
    if (typeof row !== "object" || row === null || Array.isArray(row)) return null
    const { envelopeId, deltaUsd } = row as { envelopeId?: unknown; deltaUsd?: unknown }
    if (typeof envelopeId !== "string" || envelopeId.trim().length === 0) return null
    const delta = typeof deltaUsd === "number" ? deltaUsd : Number(deltaUsd)
    if (!Number.isFinite(delta) || delta === 0) return null
    parsed.push({ envelopeId: envelopeId.trim(), deltaUsd: delta })
  }
  if (parsed.length === 0) return null
  return {
    entries: parsed,
    mode,
    config: config !== undefined ? config : undefined,
  }
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

  const parsed = parseBody(body)
  if (!parsed) {
    return NextResponse.json(
      { error: "Expected { mode: balanced|independent, entries: [{ envelopeId, deltaUsd }] }" },
      { status: 400 },
    )
  }

  const created = await createRebalanceBatch(session.user.id, parsed.entries, parsed.mode, {
    config: parsed.config as object | undefined,
  })
  if (created <= 0) {
    return NextResponse.json(
      {
        error:
          "Could not rebalance envelopes. Check envelope balances and Savings, and finish Secure Your Data setup if needed.",
      },
      { status: 400 },
    )
  }

  return NextResponse.json({ ok: true, created })
}
