import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"

const FREQUENCIES = new Set([
  "weekly",
  "bimonthly",
  "monthly",
  "every_2mo",
  "every_3mo",
  "every_6mo",
  "annually",
])

const KINDS = new Set(["income_distribution", "move_funds"])

function addMonthsUtc(date: Date, months: number): Date {
  const y = date.getUTCFullYear()
  const m = date.getUTCMonth() + months
  return new Date(Date.UTC(y, m, date.getUTCDate(), 12, 0, 0, 0))
}

export function nextRunFromFrequency(frequency: string, from: Date): Date {
  switch (frequency) {
    case "weekly":
      return new Date(from.getTime() + 7 * 86_400_000)
    case "bimonthly":
      return new Date(from.getTime() + 14 * 86_400_000)
    case "monthly":
      return addMonthsUtc(from, 1)
    case "every_2mo":
      return addMonthsUtc(from, 2)
    case "every_3mo":
      return addMonthsUtc(from, 3)
    case "every_6mo":
      return addMonthsUtc(from, 6)
    case "annually":
      return addMonthsUtc(from, 12)
    default:
      return addMonthsUtc(from, 1)
  }
}

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const rules = await prisma.recurringFundingRule.findMany({
    where: { userId: session.user.id },
    orderBy: { nextRunAt: "asc" },
  })

  return NextResponse.json({ rules })
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
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return NextResponse.json({ error: "Expected JSON object" }, { status: 400 })
  }

  const { kind, frequency, distributionConfig, nextRunAt } = body as Record<string, unknown>

  if (typeof kind !== "string" || !KINDS.has(kind)) {
    return NextResponse.json({ error: "Invalid kind" }, { status: 400 })
  }
  if (typeof frequency !== "string" || !FREQUENCIES.has(frequency)) {
    return NextResponse.json({ error: "Invalid frequency" }, { status: 400 })
  }
  if (distributionConfig === undefined || typeof distributionConfig !== "object" || distributionConfig === null) {
    return NextResponse.json({ error: "Invalid distributionConfig" }, { status: 400 })
  }

  let runAt = new Date()
  if (typeof nextRunAt === "string") {
    const parsed = new Date(nextRunAt)
    if (!Number.isNaN(parsed.getTime())) runAt = parsed
  } else {
    runAt = frequency === "weekly"
      ? new Date(runAt.getTime() + 7 * 86_400_000)
      : addMonthsUtc(runAt, 1)
  }

  const rule = await prisma.recurringFundingRule.create({
    data: {
      userId: session.user.id,
      kind,
      frequency,
      distributionConfig,
      nextRunAt: runAt,
    },
  })

  return NextResponse.json({ rule })
}

export async function DELETE(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const id = req.nextUrl.searchParams.get("id")
  if (!id?.trim()) {
    return NextResponse.json({ error: "id required" }, { status: 400 })
  }

  await prisma.recurringFundingRule.deleteMany({
    where: { id: id.trim(), userId: session.user.id },
  })

  return NextResponse.json({ ok: true })
}
