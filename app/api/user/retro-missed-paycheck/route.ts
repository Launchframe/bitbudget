import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import {
  createRetroMissedPaycheckBatch,
  getRetroMissedPaycheckStatus,
} from "@/lib/envelope-funding"

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const status = await getRetroMissedPaycheckStatus(session.user.id)
  return NextResponse.json({
    applied: status.applied,
    eligible: status.eligible,
    previewGrossUsd: status.previewGrossUsd,
    reason: status.reason ?? null,
  })
}

export async function POST() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const result = await createRetroMissedPaycheckBatch(session.user.id)
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }
  return NextResponse.json({
    ok: true,
    grossUsd: result.grossUsd,
    created: result.created,
  })
}
