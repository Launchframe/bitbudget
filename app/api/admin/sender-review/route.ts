import { requireAdmin } from "@/lib/admin"
import { logAdminAction } from "@/lib/audit-log"
import { prisma } from "@/lib/db"
import { NextRequest, NextResponse } from "next/server"

export async function GET() {
  const { error } = await requireAdmin()
  if (error) return error

  const pending = await prisma.pendingSenderReview.findMany({
    where: { status: "pending" },
    orderBy: { occurrenceCount: "desc" },
  })

  return NextResponse.json(pending)
}

export async function POST(request: NextRequest) {
  const { error, user } = await requireAdmin()
  if (error) return error
  if (!user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await request.json()
  const { id, action, displayName } = body as { id?: string; action?: string; displayName?: string }

  if (!id || !action) {
    return NextResponse.json({ error: "id and action required" }, { status: 400 })
  }

  const record = await prisma.pendingSenderReview.findUnique({ where: { id } })
  if (!record) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  if (action === "approve") {
    if (!displayName?.trim()) {
      return NextResponse.json({ error: "displayName required for approve" }, { status: 400 })
    }
    await prisma.approvedReceiptSender.create({
      data: {
        senderPattern: record.senderAddress,
        displayName: displayName.trim(),
        addedBy: user.id,
      },
    })
    await prisma.pendingSenderReview.update({
      where: { id },
      data: { status: "approved" },
    })
    await logAdminAction(user.id, "sender.approved", "PendingSenderReview", id)
  } else if (action === "dismiss") {
    await prisma.pendingSenderReview.update({
      where: { id },
      data: { status: "dismissed" },
    })
    await logAdminAction(user.id, "sender.dismissed", "PendingSenderReview", id)
  } else {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 })
  }

  return NextResponse.json({ success: true })
}
