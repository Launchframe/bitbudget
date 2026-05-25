import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/admin"
import { sendAlert } from "@/lib/alert"

/** Admin-only smoke test for Discord/Telegram/email alerting. */
export async function POST() {
  const { error } = await requireAdmin()
  if (error) return error

  const result = await sendAlert({
    severity: "info",
    source: "admin/test",
    title: "Test ops alert",
    body: "This is a test alert from the BitBudget admin ops panel.",
    fingerprint: `test:${Date.now()}`,
  })

  return NextResponse.json({ ok: true, ...result })
}
