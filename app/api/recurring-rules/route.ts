import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { parseRecurringFundingConfig, RECURRING_FUNDING_KINDS } from "@/lib/recurring-funding-config"
import {
  isRecurringFundingFrequency,
  nextRunFromFrequency,
} from "@/lib/recurring-funding-schedule"

const KINDS = new Set<string>(RECURRING_FUNDING_KINDS)

export { nextRunFromFrequency }

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
  if (typeof frequency !== "string" || !isRecurringFundingFrequency(frequency)) {
    return NextResponse.json({ error: "Invalid frequency" }, { status: 400 })
  }
  if (distributionConfig === undefined || typeof distributionConfig !== "object" || distributionConfig === null) {
    return NextResponse.json({ error: "Invalid distributionConfig" }, { status: 400 })
  }
  if (!parseRecurringFundingConfig(kind, distributionConfig)) {
    return NextResponse.json({ error: "Invalid distributionConfig shape" }, { status: 400 })
  }

  let runAt = new Date()
  if (typeof nextRunAt === "string") {
    const parsed = new Date(nextRunAt)
    if (!Number.isNaN(parsed.getTime())) runAt = parsed
  } else {
    runAt = nextRunFromFrequency(frequency, runAt)
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

export async function PATCH(req: NextRequest) {
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

  const { id, enabled } = body as Record<string, unknown>
  if (typeof id !== "string" || !id.trim()) {
    return NextResponse.json({ error: "id required" }, { status: 400 })
  }
  if (typeof enabled !== "boolean") {
    return NextResponse.json({ error: "enabled must be a boolean" }, { status: 400 })
  }

  const updated = await prisma.recurringFundingRule.updateMany({
    where: { id: id.trim(), userId: session.user.id },
    data: { enabled },
  })
  if (updated.count === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  return NextResponse.json({ ok: true })
}
