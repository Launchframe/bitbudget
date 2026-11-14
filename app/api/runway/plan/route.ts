import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import {
  parseRunwayPlanBody,
  planValuesForClientWrite,
  type EnvelopePriorityMap,
  type PlannedLine,
  type RunwayPlanValues,
  type RunwayScenario,
} from "@/lib/runway-plan"

/** Shape of a persisted RunwayPlan row we care about for serialization. */
type RunwayPlanRow = {
  phase: string
  quitDate: string | null
  horizonMonths: number
  runwayIncomeUsd: Prisma.Decimal
  livingBaselineOverrideUsd: Prisma.Decimal | null
  inflationRateYear: Prisma.Decimal
  stressPercent: Prisma.Decimal
  growthRateYear: Prisma.Decimal | null
  dipResponse: string
  btcSharePreference: string
  borrowStance: string
  editedCashFloorUsd: Prisma.Decimal | null
  editedBorrowCapFraction: Prisma.Decimal | null
  cashOverrideUsd: Prisma.Decimal | null
  bitcoinOverrideSats: bigint | null
  plannedLines: Prisma.JsonValue
  scenarios: Prisma.JsonValue
  envelopePriorities: Prisma.JsonValue
  checkupOpenedMonthKey: string | null
  createdAt: Date
  updatedAt: Date
}

function decToNumber(value: Prisma.Decimal | null): number | null {
  return value == null ? null : Number(value)
}

function serializePlan(row: RunwayPlanRow) {
  return {
    phase: row.phase,
    quitDate: row.quitDate,
    horizonMonths: row.horizonMonths,
    runwayIncomeUsd: Number(row.runwayIncomeUsd),
    livingBaselineOverrideUsd: decToNumber(row.livingBaselineOverrideUsd),
    inflationRateYear: Number(row.inflationRateYear),
    stressPercent: Number(row.stressPercent),
    growthRateYear: decToNumber(row.growthRateYear),
    dipResponse: row.dipResponse,
    btcSharePreference: row.btcSharePreference,
    borrowStance: row.borrowStance,
    editedCashFloorUsd: decToNumber(row.editedCashFloorUsd),
    editedBorrowCapFraction: decToNumber(row.editedBorrowCapFraction),
    cashOverrideUsd: decToNumber(row.cashOverrideUsd),
    bitcoinOverrideSats:
      row.bitcoinOverrideSats == null ? null : Number(row.bitcoinOverrideSats),
    plannedLines: (row.plannedLines ?? []) as unknown as PlannedLine[],
    scenarios: (row.scenarios ?? []) as unknown as RunwayScenario[],
    envelopePriorities: (row.envelopePriorities ??
      {}) as unknown as EnvelopePriorityMap,
    checkupOpenedMonthKey: row.checkupOpenedMonthKey,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

/**
 * Map validated plan values to Prisma field values (Decimal / BigInt / Json).
 * Does not include `checkupOpenedMonthKey` — that column is server-owned.
 */
function toPrismaData(values: Omit<RunwayPlanValues, "checkupOpenedMonthKey">) {
  return {
    phase: values.phase,
    quitDate: values.quitDate,
    horizonMonths: values.horizonMonths,
    runwayIncomeUsd: new Prisma.Decimal(values.runwayIncomeUsd),
    livingBaselineOverrideUsd:
      values.livingBaselineOverrideUsd == null
        ? null
        : new Prisma.Decimal(values.livingBaselineOverrideUsd),
    inflationRateYear: new Prisma.Decimal(values.inflationRateYear),
    stressPercent: new Prisma.Decimal(values.stressPercent),
    growthRateYear:
      values.growthRateYear == null
        ? null
        : new Prisma.Decimal(values.growthRateYear),
    dipResponse: values.dipResponse,
    btcSharePreference: values.btcSharePreference,
    borrowStance: values.borrowStance,
    editedCashFloorUsd:
      values.editedCashFloorUsd == null
        ? null
        : new Prisma.Decimal(values.editedCashFloorUsd),
    editedBorrowCapFraction:
      values.editedBorrowCapFraction == null
        ? null
        : new Prisma.Decimal(values.editedBorrowCapFraction),
    cashOverrideUsd:
      values.cashOverrideUsd == null
        ? null
        : new Prisma.Decimal(values.cashOverrideUsd),
    bitcoinOverrideSats:
      values.bitcoinOverrideSats == null
        ? null
        : BigInt(values.bitcoinOverrideSats),
    plannedLines: values.plannedLines as unknown as Prisma.InputJsonValue,
    scenarios: values.scenarios as unknown as Prisma.InputJsonValue,
    envelopePriorities:
      values.envelopePriorities as unknown as Prisma.InputJsonValue,
  }
}

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const userId = session.user.id

  const existing = await prisma.runwayPlan.findUnique({ where: { userId } })
  if (existing) {
    return NextResponse.json(serializePlan(existing))
  }

  // Create an empty plan (schema defaults) so the client always has a row.
  // Concurrent first-time GETs can both miss above and race to create; the
  // unique `userId` constraint means one wins and the other throws P2002.
  // Treat that as a success and re-fetch the row the winner created.
  try {
    const created = await prisma.runwayPlan.create({ data: { userId } })
    return NextResponse.json(serializePlan(created))
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      const row = await prisma.runwayPlan.findUnique({ where: { userId } })
      if (row) return NextResponse.json(serializePlan(row))
    }
    throw err
  }
}

export async function PUT(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const userId = session.user.id

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const parsed = parseRunwayPlanBody(raw)
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 })
  }

  const data = toPrismaData(planValuesForClientWrite(parsed.value))

  const saved = await prisma.runwayPlan.upsert({
    where: { userId },
    create: { userId, ...data },
    update: data,
  })

  return NextResponse.json(serializePlan(saved))
}
