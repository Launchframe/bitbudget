import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { extractIngestTokenFromRequest, ingestTokenMatches } from "@/lib/ingest-token"
import { ingestNotificationAlert } from "@/lib/notification-ingest"

/**
 * Android DIY: Tasker / MacroDroid / Automate POST bank notification text.
 * Auth: per-user notificationIngestToken (Bearer or X-BitBudget-Ingest-Token).
 * See docs/android-notification-forwarding.md
 */
export async function POST(req: NextRequest) {
  const token = extractIngestTokenFromRequest(
    req.headers.get("authorization"),
    req.headers.get("x-bitbudget-ingest-token"),
  )
  if (!token) {
    return NextResponse.json({ error: "Missing ingest token" }, { status: 401 })
  }

  const user = await prisma.user.findUnique({
    where: { notificationIngestToken: token },
    select: { id: true, notificationIngestToken: true },
  })
  if (!user?.notificationIngestToken || !ingestTokenMatches(token, user.notificationIngestToken)) {
    return NextResponse.json({ error: "Invalid ingest token" }, { status: 401 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Expected JSON object" }, { status: 400 })
  }

  const payload = body as Record<string, unknown>
  if (Object.keys(payload).length > 20) {
    return NextResponse.json({ error: "Too many JSON fields" }, { status: 400 })
  }

  const result = await ingestNotificationAlert(user.id, {
    text: typeof payload.text === "string" ? payload.text : null,
    title: typeof payload.title === "string" ? payload.title : null,
    body: typeof payload.body === "string" ? payload.body : null,
    package: typeof payload.package === "string" ? payload.package : null,
    postedAt: typeof payload.postedAt === "string" ? payload.postedAt : null,
    idempotencyKey:
      typeof payload.idempotencyKey === "string" ? payload.idempotencyKey : null,
  })

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, message: result.message },
      { status: result.status },
    )
  }

  if (result.deduplicated) {
    return NextResponse.json({ success: true, deduplicated: true })
  }

  return NextResponse.json({
    success: true,
    route: result.route,
    id: result.id,
  })
}
