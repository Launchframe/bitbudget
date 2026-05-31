import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { isReservedSavingsEnvelopeName, SYSTEM_ENVELOPE_ROLE_SAVINGS, SWEEP_POLICY_CAPPED, SWEEP_POLICY_CARRY_FORWARD, SWEEP_POLICY_RESET } from "@/lib/constants"
import { validateDecimal4_2Positive } from "@/lib/decimal-validation"

const ALLOWED_SWEEP_POLICIES = new Set([
  SWEEP_POLICY_RESET,
  SWEEP_POLICY_CARRY_FORWARD,
  SWEEP_POLICY_CAPPED,
])

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
        sweepPolicy: e.sweepPolicy ?? SWEEP_POLICY_RESET,
        sweepCapMultiplier:
          e.sweepCapMultiplier != null ? Number(e.sweepCapMultiplier) : null,
        createdAt: e.createdAt.toISOString().slice(0, 10),
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
      sweepPolicy: e.sweepPolicy ?? SWEEP_POLICY_RESET,
      sweepCapMultiplier:
        e.sweepCapMultiplier != null ? Number(e.sweepCapMultiplier) : null,
      createdAt: e.createdAt.toISOString().slice(0, 10),
    })),
  )
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let name: unknown
  let monthlyAllotment: unknown
  let color: unknown
  let icon: unknown

  try {
    ;({ name, monthlyAllotment, color, icon } = await req.json())
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  if (typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 })
  }
  const trimmedName = name.trim()

  if (isReservedSavingsEnvelopeName(trimmedName)) {
    return NextResponse.json(
      { error: `"${trimmedName}" is reserved for the system Savings envelope.` },
      { status: 400 },
    )
  }

  if (
    monthlyAllotment !== undefined &&
    monthlyAllotment !== null &&
    (typeof monthlyAllotment !== "number" ||
      !Number.isFinite(monthlyAllotment) ||
      monthlyAllotment < 0)
  ) {
    return NextResponse.json(
      { error: "monthlyAllotment must be a non-negative number" },
      { status: 400 },
    )
  }

  if (color !== undefined && color !== null && typeof color !== "string") {
    return NextResponse.json({ error: "color must be a string" }, { status: 400 })
  }

  if (icon !== undefined && icon !== null && typeof icon !== "string") {
    return NextResponse.json({ error: "icon must be a string" }, { status: 400 })
  }

  const allotment =
    typeof monthlyAllotment === "number" && Number.isFinite(monthlyAllotment)
      ? Math.max(0, monthlyAllotment)
      : 0
  const envelopeColor = typeof color === "string" && color.trim() ? color : "#F7931A"
  const envelopeIcon = typeof icon === "string" ? icon : null

  let envelope
  try {
    envelope = await prisma.envelope.create({
      data: {
        userId: session.user.id,
        name: trimmedName,
        monthlyAllotment: allotment,
        color: envelopeColor,
        icon: envelopeIcon,
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
    sweepPolicy: envelope.sweepPolicy ?? SWEEP_POLICY_RESET,
    sweepCapMultiplier:
      envelope.sweepCapMultiplier != null ? Number(envelope.sweepCapMultiplier) : null,
    createdAt: envelope.createdAt.toISOString().slice(0, 10),
  }, { status: 201 })
}

export async function PUT(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let id
  let name
  let monthlyAllotment
  let color
  let icon
  let archived
  let sweepPolicy
  let sweepCapMultiplier

  try {
    ;({ id, name, monthlyAllotment, color, icon, archived, sweepPolicy, sweepCapMultiplier } = await req.json())
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  if (typeof id !== "string" || id.trim() === "") {
    return NextResponse.json({ error: "Envelope ID must be a non-empty string" }, { status: 400 })
  }
  const envelopeId = id.trim()

  const existing = await prisma.envelope.findFirst({
    where: { id: envelopeId, userId: session.user.id },
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
    if (isReservedSavingsEnvelopeName(name)) {
      return NextResponse.json(
        { error: `"${name.trim()}" is reserved for the system Savings envelope.` },
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

  let normalizedAllotment: number | undefined
  if (monthlyAllotment !== undefined) {
    if (
      monthlyAllotment !== null &&
      (typeof monthlyAllotment !== "number" ||
        !Number.isFinite(monthlyAllotment) ||
        monthlyAllotment < 0)
    ) {
      return NextResponse.json(
        { error: "monthlyAllotment must be a non-negative number" },
        { status: 400 },
      )
    }
    if (typeof monthlyAllotment === "number" && Number.isFinite(monthlyAllotment)) {
      normalizedAllotment = Math.max(0, Math.round(monthlyAllotment * 100) / 100)
    }
  }

  if (sweepPolicy !== undefined) {
    if (typeof sweepPolicy !== "string" || !ALLOWED_SWEEP_POLICIES.has(sweepPolicy)) {
      return NextResponse.json({ error: "Invalid sweepPolicy" }, { status: 400 })
    }
  }

  let normalizedSweepCap: number | null | undefined
  if (sweepCapMultiplier !== undefined) {
    if (sweepCapMultiplier === null) {
      normalizedSweepCap = null
    } else {
      if (typeof sweepCapMultiplier !== "number" || !Number.isFinite(sweepCapMultiplier)) {
        return NextResponse.json({ error: "sweepCapMultiplier must be a positive number or null" }, { status: 400 })
      }
      const validated = validateDecimal4_2Positive(sweepCapMultiplier, "sweepCapMultiplier")
      if (!validated.ok) {
        return NextResponse.json({ error: validated.error }, { status: 400 })
      }
      normalizedSweepCap = validated.value
    }
  }

  let updated
  try {
    updated = await prisma.envelope.update({
      where: { id: envelopeId },
      data: {
        ...(existing.systemRole !== SYSTEM_ENVELOPE_ROLE_SAVINGS && name !== undefined ? { name: name.trim() } : {}),
        ...(normalizedAllotment !== undefined ? { monthlyAllotment: normalizedAllotment } : {}),
        ...(color !== undefined ? { color } : {}),
        ...(icon !== undefined ? { icon } : {}),
        ...(archived !== undefined ? { archived } : {}),
        ...(sweepPolicy !== undefined ? { sweepPolicy } : {}),
        ...(normalizedSweepCap !== undefined
          ? {
              sweepCapMultiplier:
                normalizedSweepCap === null ? null : new Prisma.Decimal(normalizedSweepCap),
            }
          : {}),
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
    sweepPolicy: updated.sweepPolicy ?? SWEEP_POLICY_RESET,
    sweepCapMultiplier:
      updated.sweepCapMultiplier != null ? Number(updated.sweepCapMultiplier) : null,
    createdAt: updated.createdAt.toISOString().slice(0, 10),
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
