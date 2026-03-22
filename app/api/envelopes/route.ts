import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"

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
    })),
  )
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { name, monthlyAllotment, color, icon } = await req.json()
  if (!name) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 })
  }

  let envelope
  try {
    envelope = await prisma.envelope.create({
      data: {
        userId: session.user.id,
        name,
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

  let updated
  try {
    updated = await prisma.envelope.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name } : {}),
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
    await prisma.transaction.deleteMany({ where: { userId: session.user.id } })
    const { count } = await prisma.envelope.deleteMany({ where: { userId: session.user.id } })
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

  const userId = session.user.id

  await prisma.$transaction(async tx => {
    await tx.pendingTransaction.updateMany({
      where: { userId, suggestedEnvelopeId: id },
      data: { suggestedEnvelopeId: null },
    })
    await tx.transactionShortcut.deleteMany({
      where: { userId, envelopeId: id },
    })
    await tx.transaction.deleteMany({ where: { envelopeId: id, userId } })
    await tx.envelope.delete({ where: { id } })
  })

  return NextResponse.json({ success: true })
}
