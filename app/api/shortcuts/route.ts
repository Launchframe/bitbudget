import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const shortcuts = await prisma.transactionShortcut.findMany({
    where: { userId: session.user.id },
    orderBy: { usageCount: "desc" },
  })

  return NextResponse.json(
    shortcuts.map((s) => ({
      id: s.id,
      payee: s.payee,
      defaultAmount: s.defaultAmount,
      envelopeId: s.envelopeId,
      label: s.label,
      usageCount: s.usageCount,
    }))
  )
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await req.json()
  const { payee, defaultAmount, envelopeId, label } = body

  if (!payee || !envelopeId) {
    return NextResponse.json({ error: "payee and envelopeId are required" }, { status: 400 })
  }

  const envelope = await prisma.envelope.findFirst({
    where: { id: envelopeId, userId: session.user.id },
  })
  if (!envelope) {
    return NextResponse.json({ error: "Envelope not found" }, { status: 404 })
  }

  const shortcut = await prisma.transactionShortcut.create({
    data: {
      userId: session.user.id,
      payee: String(payee).trim(),
      defaultAmount: defaultAmount != null ? Math.abs(Number(defaultAmount)) : null,
      envelopeId,
      label: label != null ? String(label).trim() || null : null,
    },
  })

  return NextResponse.json(
    {
      id: shortcut.id,
      payee: shortcut.payee,
      defaultAmount: shortcut.defaultAmount,
      envelopeId: shortcut.envelopeId,
      label: shortcut.label,
      usageCount: shortcut.usageCount,
    },
    { status: 201 }
  )
}

export async function PUT(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await req.json()
  const { id, payee, defaultAmount, envelopeId, label } = body

  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 })
  }

  const existing = await prisma.transactionShortcut.findFirst({
    where: { id, userId: session.user.id },
  })
  if (!existing) {
    return NextResponse.json({ error: "Shortcut not found" }, { status: 404 })
  }

  if (envelopeId && envelopeId !== existing.envelopeId) {
    const envelope = await prisma.envelope.findFirst({
      where: { id: envelopeId, userId: session.user.id },
    })
    if (!envelope) {
      return NextResponse.json({ error: "Envelope not found" }, { status: 404 })
    }
  }

  const updated = await prisma.transactionShortcut.update({
    where: { id },
    data: {
      ...(payee !== undefined && { payee: String(payee).trim() }),
      ...(defaultAmount !== undefined && {
        defaultAmount: defaultAmount != null ? Math.abs(Number(defaultAmount)) : null,
      }),
      ...(envelopeId !== undefined && { envelopeId }),
      ...(label !== undefined && { label: label != null ? String(label).trim() || null : null }),
    },
  })

  return NextResponse.json({
    id: updated.id,
    payee: updated.payee,
    defaultAmount: updated.defaultAmount,
    envelopeId: updated.envelopeId,
    label: updated.label,
    usageCount: updated.usageCount,
  })
}

export async function DELETE(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { searchParams } = req.nextUrl
  const id = searchParams.get("id")

  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 })
  }

  const existing = await prisma.transactionShortcut.findFirst({
    where: { id, userId: session.user.id },
  })
  if (!existing) {
    return NextResponse.json({ error: "Shortcut not found" }, { status: 404 })
  }

  await prisma.transactionShortcut.delete({ where: { id } })
  return NextResponse.json({ success: true })
}
