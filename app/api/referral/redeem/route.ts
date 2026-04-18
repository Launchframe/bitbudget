import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { redeemReferralCode } from "@/lib/referral"
import { notifyReferralAccepted, userContactLabel } from "@/lib/notify"

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let body: { code?: string; shareMethod?: string }
  try {
    body = (await req.json()) as { code?: string; shareMethod?: string }
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const rawCode = typeof body.code === "string" ? body.code : ""
  if (!rawCode.trim()) {
    return NextResponse.json({ error: "code required" }, { status: 400 })
  }

  const shareMethod =
    typeof body.shareMethod === "string" && body.shareMethod.trim()
      ? body.shareMethod.trim().slice(0, 32)
      : "direct"

  const result = await redeemReferralCode({
    refereeId: session.user.id,
    rawCode,
    shareMethod,
  })

  if (!result.ok) {
    return NextResponse.json(
      { error: result.message, code: result.code },
      { status: result.status },
    )
  }

  if (result.codeType === "user") {
    const referee = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { name: true, email: true, nostrPubkey: true },
    })
    const refereeName = userContactLabel(referee ?? {})
    await notifyReferralAccepted({
      referrerId: result.referrerId,
      refereeName,
    })
  }

  return NextResponse.json({ ok: true })
}
