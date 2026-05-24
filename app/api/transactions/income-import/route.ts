import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { awardIfMissing, detectAchievementsForUser } from "@/lib/achievements"
import {
  type IncomeImportEntry,
  parseIncomePeriodKey,
  processIncomeImport,
} from "@/lib/income-import"

function parseEntries(body: unknown): IncomeImportEntry[] | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null
  const { entries } = body as { entries?: unknown }
  if (!Array.isArray(entries)) return null

  const parsed: IncomeImportEntry[] = []
  for (const row of entries) {
    if (typeof row !== "object" || row === null || Array.isArray(row)) return null
    const rec = row as Record<string, unknown>
    const periodKey = rec.periodKey
    const amountRaw = rec.amount
    if (typeof periodKey !== "string" || !parseIncomePeriodKey(periodKey)) return null
    const amount = typeof amountRaw === "number" ? amountRaw : Number(amountRaw)
    if (!Number.isFinite(amount) || amount <= 0) return null

    const entry: IncomeImportEntry = { periodKey, amount }
    if (rec.source !== undefined) {
      if (typeof rec.source !== "string") return null
      entry.source = rec.source.trim() || undefined
    }
    if (rec.splitCount !== undefined) {
      const split = typeof rec.splitCount === "number" ? rec.splitCount : Number(rec.splitCount)
      if (!Number.isFinite(split) || split < 1 || split > 52) return null
      entry.splitCount = Math.floor(split)
    }
    parsed.push(entry)
  }
  return parsed
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
  if (!entries || entries.length === 0) {
    return NextResponse.json(
      { error: "entries must be a non-empty array of { periodKey, amount, source?, splitCount? }" },
      { status: 400 },
    )
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      monthlyIncome: true,
      publicKey: true,
      payDays: true,
    },
  })

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  if (!Number.isFinite(user.monthlyIncome) || user.monthlyIncome <= 0) {
    return NextResponse.json(
      { error: "Set a positive Monthly Income before importing income." },
      { status: 400 },
    )
  }

  if (typeof user.publicKey !== "string" || user.publicKey.trim() === "") {
    return NextResponse.json(
      { error: "Encryption is not configured." },
      { status: 400 },
    )
  }

  const created = await processIncomeImport({
    userId: session.user.id,
    publicKey: user.publicKey,
    monthlyIncome: user.monthlyIncome,
    payDays: user.payDays,
    entries,
  })

  if (created <= 0) {
    return NextResponse.json(
      { error: "No income was imported. Entries may already exist or encryption is not configured." },
      { status: 400 },
    )
  }

  await awardIfMissing(session.user.id, "import_complete")
  await detectAchievementsForUser(session.user.id)

  return NextResponse.json({ ok: true, created })
}
