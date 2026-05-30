import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { generateIngestToken } from "@/lib/ingest-token"
import { premiumForbiddenResponse, requirePremiumOrTrial } from "@/lib/subscription"

function webhookBaseUrl(): string {
  const base =
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.NEXTAUTH_URL?.trim() ||
    "http://localhost:3000"
  return base.replace(/\/$/, "")
}

async function ensureToken(userId: string, rotate: boolean): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { notificationIngestToken: true },
  })
  if (!user) throw new Error("User not found")
  if (user.notificationIngestToken && !rotate) {
    return user.notificationIngestToken
  }
  const notificationIngestToken = generateIngestToken()
  await prisma.user.update({
    where: { id: userId },
    data: { notificationIngestToken },
  })
  return notificationIngestToken
}

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  if (!(await requirePremiumOrTrial(session.user.id))) {
    return premiumForbiddenResponse(
      "Notification forwarding requires a premium subscription or an active premium trial",
    )
  }

  const notificationIngestToken = await ensureToken(session.user.id, false)
  return NextResponse.json({
    notificationIngestToken,
    webhookUrl: `${webhookBaseUrl()}/api/webhooks/notification-ingest`,
  })
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  if (!(await requirePremiumOrTrial(session.user.id))) {
    return premiumForbiddenResponse(
      "Notification forwarding requires a premium subscription or an active premium trial",
    )
  }

  let rotate = false
  try {
    const body = (await req.json()) as { rotate?: unknown }
    rotate = body?.rotate === true
  } catch {
    // empty body is fine
  }

  const notificationIngestToken = await ensureToken(session.user.id, rotate)
  return NextResponse.json({
    notificationIngestToken,
    webhookUrl: `${webhookBaseUrl()}/api/webhooks/notification-ingest`,
    rotated: rotate,
  })
}
