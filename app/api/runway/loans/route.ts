import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import {
  parseLoanCreateBody,
  parseLoanUpdateBody,
  toLoanHealthInput,
  validateCalendarDate,
  type LoanUpdateInput,
} from "@/lib/btc-loan"
import { evaluateLoan, type LoanPayoffStyle } from "@/lib/loan-health"

/** Default borrow cap / max LTV used for the rollover check in GET summaries. */
const DEFAULT_BORROW_CAP_FRACTION = 0.5

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

  const rows = (await prisma.btcLoan.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  })) as LoanRow[]

  const serialized = rows.map(serializeLoan)

  // Optional live summary: only when a positive btcPriceUsd is supplied.
  const btcPriceParam = req.nextUrl.searchParams.get("btcPriceUsd")
  if (btcPriceParam == null || btcPriceParam.trim() === "") {
    return NextResponse.json({ loans: serialized })
  }

  const btcPriceUsd = Number(btcPriceParam.trim())
  if (!Number.isFinite(btcPriceUsd) || btcPriceUsd < 0) {
    return NextResponse.json(
      { error: "btcPriceUsd must be a non-negative number" },
      { status: 400 },
    )
  }

  const asOfParam = req.nextUrl.searchParams.get("asOf")
  let asOfDate = todayUtcDate()
  if (asOfParam != null && asOfParam.trim() !== "") {
    // Validate it is a real calendar date (rejects e.g. 2026-02-31), not just
    // the YYYY-MM-DD shape, so we never summarize for a rolled-over date.
    const parsedAsOf = validateCalendarDate(asOfParam, "asOf")
    if (!parsedAsOf.ok) {
      return NextResponse.json({ error: parsedAsOf.error }, { status: 400 })
    }
    asOfDate = parsedAsOf.value
  }

  const capParam = req.nextUrl.searchParams.get("borrowCapFraction")
  let borrowCapFraction = DEFAULT_BORROW_CAP_FRACTION
  if (capParam != null && capParam.trim() !== "") {
    const cap = Number(capParam.trim())
    if (!Number.isFinite(cap) || cap <= 0 || cap > 1) {
      return NextResponse.json(
        { error: "borrowCapFraction must be between 0 and 1" },
        { status: 400 },
      )
    }
    borrowCapFraction = cap
  }

  const ctx = { btcPriceUsd, asOfDate, borrowCapFraction }
  const loans = serialized.map((loan) => ({
    ...loan,
    summary: evaluateLoan(
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

  // Re-check date ordering against stored values when only one date changed.
  const u: LoanUpdateInput = parsed.value
  const nextOpenedOn = u.openedOn ?? existing.openedOn
  const nextMaturityOn = u.maturityOn ?? existing.maturityOn
  if (nextMaturityOn < nextOpenedOn) {
    return NextResponse.json(
      { error: "Maturity date must be on or after the open date" },
      { status: 400 },
    )
  }

  const data: Prisma.BtcLoanUpdateInput = {}
  if (u.label !== undefined) data.label = u.label
  if (u.principalUsd !== undefined) data.principalUsd = new Prisma.Decimal(u.principalUsd)
  if (u.aprFraction !== undefined) data.apr = new Prisma.Decimal(u.aprFraction)
  if (u.openedOn !== undefined) data.openedOn = u.openedOn
  if (u.maturityOn !== undefined) data.maturityOn = u.maturityOn
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

  const updated = (await prisma.btcLoan.update({
    where: { id: existing.id },
    data,
  })) as LoanRow

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
