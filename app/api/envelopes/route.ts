import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { isReservedSavingsEnvelopeName, SYSTEM_ENVELOPE_ROLE_SAVINGS } from "@/lib/constants"

/**
 * List envelopes for the signed-in user.
 * Query `usage=1` adds `transactionCount` and `recurringCount` per row (for onboarding delete UX).
 */
export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const withUsage = req.nextUrl.searchParams.get("usage") === "1"

  if (withUsage) {
    const envelopes = await prisma.envelope.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: "asc" },
      include: {
        _count: {
          select: {
            transactions: true,
            recurringTransactions: true,
          },
        },
      },
    })

    return NextResponse.json(
      envelopes.map(e => ({
        id: e.id,
        name: e.name,
        monthlyAllotment: e.monthlyAllotment,
        color: e.color,
        icon: e.icon,
        archived: e.archived,
        systemRole: e.systemRole ?? null,
        transactionCount: e._count.transactions,
        recurringCount: e._count.recurringTransactions,
      })),
    )
  }

  const envelopes = await prisma.envelope.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "asc" },
  })

  return NextResponse.json(
    envelopes.map(e => ({
      id: e.id,
      name: e.name,
      monthlyAllotment: e.monthlyAllotment,
      color: e.color,
      icon: e.icon,
      archived: e.archived,
      systemRole: e.systemRole ?? null,
    })),
  )
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { name, monthlyAllotment, color, icon } = await req.json()
  if (typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 })
  }
  const trimmedName = name.trim()

  const userLedger = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { ledgerFundingEnabled: true },
  })
  if (userLedger?.ledgerFundingEnabled && isReservedSavingsEnvelopeName(trimmedName)) {
    return NextResponse.json(
      { error: `"${trimmedName}" is reserved for ledger Savings.` },
      { status: 400 },
    )
  }

  let envelope
  try {
    envelope = await prisma.envelope.create({
      data: {
        userId: session.user.id,
        name: trimmedName,
        monthlyAllotment: monthlyAllotment || 0,
        color: color || "#F7931A",
        icon,
      },
    })
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return NextResponse.json(
        { error: "An envelope with this name already exists" },
        { status: 409 },
      )
    }
    throw e
  }

  return NextResponse.json({
    id: envelope.id,
    name: envelope.name,
    monthlyAllotment: envelope.monthlyAllotment,
    color: envelope.color,
    icon: envelope.icon,
    archived: envelope.archived,
    systemRole: envelope.systemRole ?? null,
  }, { status: 201 })
}

export async function PUT(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id, name, monthlyAllotment, color, icon, archived } = await req.json()
  if (!id) {
    return NextResponse.json({ error: "Envelope ID is required" }, { status: 400 })
  }

  const existing = await prisma.envelope.findFirst({
    where: { id, userId: session.user.id },
  })
  if (!existing) {
    return NextResponse.json({ error: "Envelope not found" }, { status: 404 })
  }

  if (name !== undefined) {
    if (typeof name !== "string") {
      return NextResponse.json({ error: "Name must be a string" }, { status: 400 })
    }
    if (existing.systemRole === SYSTEM_ENVELOPE_ROLE_SAVINGS) {
      return NextResponse.json(
        { error: "The system Savings envelope name cannot be changed." },
        { status: 403 },
      )
    }
    const userLedger = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { ledgerFundingEnabled: true },
    })
    if (userLedger?.ledgerFundingEnabled && isReservedSavingsEnvelopeName(name)) {
      return NextResponse.json(
        { error: `"${name.trim()}" is reserved for ledger Savings.` },
        { status: 400 },
      )
    }
  }

  if (existing.systemRole === SYSTEM_ENVELOPE_ROLE_SAVINGS) {
    if (archived === true) {
      return NextResponse.json(
        { error: "The system Savings envelope cannot be archived." },
        { status: 403 },
      )
    }
    if (monthlyAllotment !== undefined) {
      return NextResponse.json(
        { error: "The system Savings envelope allotment cannot be changed." },
        { status: 403 },
      )
    }
  }

  let updated
  try {
    updated = await prisma.envelope.update({
      where: { id },
      data: {
        ...(existing.systemRole !== SYSTEM_ENVELOPE_ROLE_SAVINGS && name !== undefined ? { name: name.trim() } : {}),
        ...(monthlyAllotment !== undefined ? { monthlyAllotment } : {}),
        ...(color !== undefined ? { color } : {}),
        ...(icon !== undefined ? { icon } : {}),
        ...(archived !== undefined ? { archived } : {}),
      },
    })
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return NextResponse.json(
        { error: "An envelope with this name already exists" },
        { status: 409 },
      )
    }
    throw e
  }

  return NextResponse.json({
    id: updated.id,
    name: updated.name,
    monthlyAllotment: updated.monthlyAllotment,
    color: updated.color,
    icon: updated.icon,
    archived: updated.archived,
    systemRole: updated.systemRole ?? null,
  })
}

export async function DELETE(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { searchParams } = req.nextUrl
  const all = searchParams.get("all")

  if (all === "true") {
    const userId = session.user.id
    const { count } = await prisma.$transaction(async tx => {
      await tx.pendingTransaction.updateMany({
        where: { userId },
        data: { suggestedEnvelopeId: null },
      })
      await tx.transactionShortcut.deleteMany({ where: { userId } })
      // Explicit destructive reset (Settings → Clear all data): remove every envelope, including system Savings.
      // Transactions/recurring/payee mappings cascade when envelopes are removed; shortcuts do not.
      return tx.envelope.deleteMany({ where: { userId } })
    })
    return NextResponse.json({ deleted: count })
  }

  const id = searchParams.get("id")
  if (!id) {
    return NextResponse.json({ error: "Envelope ID required" }, { status: 400 })
  }

  const existing = await prisma.envelope.findFirst({
    where: { id, userId: session.user.id },
  })
  if (!existing) {
    return NextResponse.json({ error: "Envelope not found" }, { status: 404 })
  }

  if (existing.systemRole === SYSTEM_ENVELOPE_ROLE_SAVINGS) {
    return NextResponse.json(
      { error: "The system Savings envelope cannot be deleted." },
      { status: 403 },
    )
  }

  const userId = session.user.id

  await prisma.$transaction(async tx => {
    await tx.pendingTransaction.updateMany({
      where: { userId, suggestedEnvelopeId: id },
      data: { suggestedEnvelopeId: null },
    })
    await tx.transactionShortcut.deleteMany({
      where: { userId, envelopeId: id },
    })
    // Transactions cascade-delete with the envelope (Prisma schema); explicit deleteMany is redundant.
    await tx.envelope.delete({ where: { id } })
  })

  return NextResponse.json({ success: true })
}
