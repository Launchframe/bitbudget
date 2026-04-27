import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import {
  NotificationEmailLinkError,
  sendNotificationEmailLinkCode,
  unlinkNotificationEmail,
  verifyNotificationEmailLink,
} from "@/lib/notification-email-link"
import { isNotificationEmailVerified } from "@/lib/notification-contact"

function errorResponse(err: unknown) {
  if (err instanceof NotificationEmailLinkError) {
    return NextResponse.json({ error: err.message, code: err.code }, { status: err.status })
  }
  console.error("notification-email error:", err)
  return NextResponse.json({ error: "Request failed" }, { status: 500 })
}

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      email: true,
      notificationEmail: true,
      notificationEmailVerified: true,
      nostrPubkey: true,
      nostrDmEnabled: true,
    },
  })
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  return NextResponse.json({
    loginEmail: user.email,
    notificationEmail: user.notificationEmail,
    notificationEmailVerified: isNotificationEmailVerified(user.notificationEmailVerified),
    nostrPubkey: user.nostrPubkey,
    nostrDmEnabled: user.nostrDmEnabled,
  })
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return NextResponse.json({ error: "Expected a JSON object" }, { status: 400 })
  }

  const { action, email, code } = body as { action?: unknown; email?: unknown; code?: unknown }
  if (action !== "send-code" && action !== "verify") {
    return NextResponse.json({ error: "action must be send-code or verify" }, { status: 400 })
  }
  if (typeof email !== "string") {
    return NextResponse.json({ error: "email is required" }, { status: 400 })
  }

  try {
    if (action === "send-code") {
      const result = await sendNotificationEmailLinkCode(session.user.id, email)
      return NextResponse.json(result)
    }
    if (typeof code !== "string") {
      return NextResponse.json({ error: "code is required" }, { status: 400 })
    }
    const result = await verifyNotificationEmailLink(session.user.id, email, code)
    return NextResponse.json(result)
  } catch (err) {
    return errorResponse(err)
  }
}

export async function DELETE() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const result = await unlinkNotificationEmail(session.user.id)
    return NextResponse.json(result)
  } catch (err) {
    return errorResponse(err)
  }
}
