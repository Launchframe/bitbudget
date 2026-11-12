import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import {
  parseLoanCreateBody,
  parseLoanSummaryQuery,
  parseLoanUpdateBody,
  resolveLoanDateUpdate,
  serializeLoanEvaluation,
  toLoanHealthInput,
  type LoanUpdateInput,
} from "@/lib/btc-loan"
import { evaluateLoan, type LoanPayoffStyle } from "@/lib/loan-health"

/** Shape of a loan row selected from the DB. */
interface LoanRow {
  id: string
  label: string
  principalUsd: Prisma.Decimal
  apr: Prisma.Decimal
  openedOn: string
  maturityOn: string
  collateralSats: bigint
  lenderSellPriceUsd: Prisma.Decimal
  payoffStyle: string
  maturityBillOverrideUsd: Prisma.Decimal | null
  status: string
  createdAt: Date
  updatedAt: Date
}

function todayUtcDate(): string {
  return new Date().toISOString().slice(0, 10)
}

/** JSON-safe representation of a stored loan (Decimals → numbers, BigInt → number). */
function serializeLoan(row: LoanRow) {
  return {
    id: row.id,
    label: row.label,
    principalUsd: Number(row.principalUsd),
    apr: Number(row.apr),
    openedOn: row.openedOn,
    maturityOn: row.maturityOn,
    collateralSats: Number(row.collateralSats),
    lenderSellPriceUsd: Number(row.lenderSellPriceUsd),
    payoffStyle: row.payoffStyle,
    maturityBillOverrideUsd:
      row.maturityBillOverrideUsd == null ? null : Number(row.maturityBillOverrideUsd),
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const userId = session.user.id

  // Validate summary params before the read so a bad asOf/price is a 400
  // even when the database is unavailable.
  const summaryQuery = parseLoanSummaryQuery(req.nextUrl.searchParams, todayUtcDate())
  if (!summaryQuery.ok) {
    return NextResponse.json({ error: summaryQuery.error }, { status: 400 })
  }

  const rows = (await prisma.btcLoan.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  })) as LoanRow[]

  const serialized = rows.map(serializeLoan)

  if (!summaryQuery.value.summarize) {
    return NextResponse.json({ loans: serialized })
  }

  const { btcPriceUsd, asOfDate, borrowCapFraction } = summaryQuery.value
  const ctx = { btcPriceUsd, asOfDate, borrowCapFraction }
  const loans = serialized.map((loan) => ({
    ...loan,
    // Serialize so an infinite rollover price survives JSON as an explicit
    // null + rolloverPriceKnown:false sentinel (JSON.stringify(Infinity) → null).
    summary: serializeLoanEvaluation(
      evaluateLoan(
        toLoanHealthInput({
          id: loan.id,
          principalUsd: loan.principalUsd,
          apr: loan.apr,
          openedOn: loan.openedOn,
          maturityOn: loan.maturityOn,
          collateralSats: loan.collateralSats,
          lenderSellPriceUsd: loan.lenderSellPriceUsd,
          payoffStyle: loan.payoffStyle as LoanPayoffStyle,
          maturityBillOverrideUsd: loan.maturityBillOverrideUsd,
        }),
        ctx,
      ),
    ),
  }))

  return NextResponse.json({ loans, btcPriceUsd, asOfDate, borrowCapFraction })
}

export async function POST(req: NextRequest) {
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

  const parsed = parseLoanCreateBody(raw)
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 })
  }
  const v = parsed.value

  const created = (await prisma.btcLoan.create({
    data: {
      userId,
      label: v.label,
      principalUsd: new Prisma.Decimal(v.principalUsd),
      apr: new Prisma.Decimal(v.aprFraction),
      openedOn: v.openedOn,
      maturityOn: v.maturityOn,
      collateralSats: BigInt(v.collateralSats),
      lenderSellPriceUsd: new Prisma.Decimal(v.lenderSellPriceUsd),
      payoffStyle: v.payoffStyle,
      maturityBillOverrideUsd:
        v.maturityBillOverrideUsd == null
          ? null
          : new Prisma.Decimal(v.maturityBillOverrideUsd),
      status: v.status,
    },
  })) as LoanRow

  return NextResponse.json({ loan: serializeLoan(created) }, { status: 201 })
}

function resolveLoanId(req: NextRequest, body: unknown): string | null {
  const queryId = req.nextUrl.searchParams.get("id")
  if (queryId != null && queryId.trim() !== "") return queryId.trim()
  if (
    typeof body === "object" &&
    body !== null &&
    typeof (body as Record<string, unknown>).id === "string"
  ) {
    const bodyId = (body as Record<string, string>).id.trim()
    if (bodyId !== "") return bodyId
  }
  return null
}

export async function PATCH(req: NextRequest) {
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

  const id = resolveLoanId(req, raw)
  if (!id) {
    return NextResponse.json({ error: "Loan id is required" }, { status: 400 })
  }

  const parsed = parseLoanUpdateBody(raw)
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 })
  }

  const existing = (await prisma.btcLoan.findFirst({
    where: { id, userId },
  })) as LoanRow | null
  if (!existing) {
    return NextResponse.json({ error: "Loan not found" }, { status: 404 })
  }

  // When either date changes, persist both so overlapping patches cannot
  // interleave into maturity-before-open.
  const u: LoanUpdateInput = parsed.value
  const dates = resolveLoanDateUpdate(existing, u)
  if (!dates.ok) {
    return NextResponse.json({ error: dates.error }, { status: 400 })
  }

  const data: Prisma.BtcLoanUpdateInput = {}
  if (u.label !== undefined) data.label = u.label
  if (u.principalUsd !== undefined) data.principalUsd = new Prisma.Decimal(u.principalUsd)
  if (u.aprFraction !== undefined) data.apr = new Prisma.Decimal(u.aprFraction)
  if (dates.value) {
    data.openedOn = dates.value.openedOn
    data.maturityOn = dates.value.maturityOn
  }
  if (u.collateralSats !== undefined) data.collateralSats = BigInt(u.collateralSats)
  if (u.lenderSellPriceUsd !== undefined)
    data.lenderSellPriceUsd = new Prisma.Decimal(u.lenderSellPriceUsd)
  if (u.payoffStyle !== undefined) data.payoffStyle = u.payoffStyle
  if (u.maturityBillOverrideUsd !== undefined)
    data.maturityBillOverrideUsd =
      u.maturityBillOverrideUsd == null
        ? null
        : new Prisma.Decimal(u.maturityBillOverrideUsd)
  if (u.status !== undefined) data.status = u.status

  // updateMany stays scoped by userId (update() can only filter on the unique id).
  const result = await prisma.btcLoan.updateMany({
    where: { id: existing.id, userId },
    data,
  })
  if (result.count === 0) {
    return NextResponse.json({ error: "Loan not found" }, { status: 404 })
  }

  const updated = (await prisma.btcLoan.findFirst({
    where: { id: existing.id, userId },
  })) as LoanRow | null
  if (!updated) {
    return NextResponse.json({ error: "Loan not found" }, { status: 404 })
  }

  return NextResponse.json({ loan: serializeLoan(updated) })
}

export async function DELETE(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const userId = session.user.id

  const id = req.nextUrl.searchParams.get("id")?.trim()
  if (!id) {
    return NextResponse.json({ error: "Loan id is required" }, { status: 400 })
  }

  // Ownership-scoped delete; deleteMany returns a count so we never leak
  // whether another user's row exists.
  const result = await prisma.btcLoan.deleteMany({ where: { id, userId } })
  if (result.count === 0) {
    return NextResponse.json({ error: "Loan not found" }, { status: 404 })
  }

  return NextResponse.json({ success: true, deletedId: id })
}
