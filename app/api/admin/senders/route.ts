import { requireAdmin } from "@/lib/admin"
import { logAdminAction } from "@/lib/audit-log"
import { prisma } from "@/lib/db"
import { NextRequest, NextResponse } from "next/server"

export async function GET() {
  const { error } = await requireAdmin()
  if (error) return error

  const senders = await prisma.approvedReceiptSender.findMany({
    include: { admin: { select: { email: true, name: true } } },
    orderBy: { displayName: "asc" },
  })

  return NextResponse.json(senders)
}

export async function POST(request: NextRequest) {
  const { error, user } = await requireAdmin()
  if (error) return error

  const body = await request.json()
  const { senderPattern, displayName } = body as { senderPattern?: string; displayName?: string }

  if (!senderPattern?.trim() || !displayName?.trim()) {
    return NextResponse.json({ error: "senderPattern and displayName required" }, { status: 400 })
  }

  const newSender = await prisma.approvedReceiptSender.create({
    data: {
      senderPattern: senderPattern.trim(),
      displayName: displayName.trim(),
      addedBy: user!.id,
    },
  })

  await logAdminAction(user!.id, "sender.created", "ApprovedReceiptSender", newSender.id)

  return NextResponse.json(newSender, { status: 201 })
}

export async function DELETE(request: NextRequest) {
  const { error, user } = await requireAdmin()
  if (error) return error

  const id = request.nextUrl.searchParams.get("id")
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 })
  }

  await prisma.approvedReceiptSender.delete({ where: { id } })
  await logAdminAction(user!.id, "sender.deleted", "ApprovedReceiptSender", id)

  return NextResponse.json({ success: true })
}
