import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { recordRenewalReminderLog } from "@/lib/premium-renewal-server"

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const logKey = typeof (body as { logKey?: unknown }).logKey === "string"
    ? (body as { logKey: string }).logKey.trim()
    : ""
  if (!logKey || logKey.length > 120) {
    return NextResponse.json({ error: "Invalid logKey" }, { status: 400 })
  }

  await recordRenewalReminderLog(session.user.id, logKey, "in_app_dismissed")

  return NextResponse.json({ dismissed: true })
}
