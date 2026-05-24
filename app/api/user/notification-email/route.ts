import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import {
  NotificationEmailLinkError,
  listUserNotificationEmails,
  sendNotificationEmailLinkCode,
  unlinkNotificationEmail,
  verifyNotificationEmailLink,
} from "@/lib/notification-email-link"

function errorResponse(err: unknown) {
  if (err instanceof NotificationEmailLinkError) {
    return NextResponse.json({ error: err.message, code: err.code }, { status: err.status })
  }
  console.error("notification-email error:", err)
  return NextResponse.json({ error: "Request failed" }, { status: 500 })
}

function serializeEmails(
  rows: { id: string; email: string; verifiedAt: Date }[],
) {
  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    verifiedAt: r.verifiedAt.toISOString(),
  }))
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
      nostrPubkey: true,
      nostrDmEnabled: true,
    },
  })
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const notificationEmails = await listUserNotificationEmails(session.user.id)

  return NextResponse.json({
    loginEmail: user.email,
    notificationEmails: serializeEmails(notificationEmails),
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

export async function DELETE(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let target: string | null = req.nextUrl.searchParams.get("email")?.trim()
    ?? req.nextUrl.searchParams.get("id")?.trim()
    ?? null

  if (!target) {
    try {
      const body = (await req.json()) as { email?: unknown; id?: unknown }
      if (typeof body.id === "string") target = body.id.trim()
      else if (typeof body.email === "string") target = body.email.trim()
    } catch {
      /* empty body is fine when query params were used */
    }
  }

  if (!target) {
    return NextResponse.json({ error: "email or id is required" }, { status: 400 })
  }

  try {
    const result = await unlinkNotificationEmail(session.user.id, target)
    return NextResponse.json(result)
  } catch (err) {
    return errorResponse(err)
  }
}
