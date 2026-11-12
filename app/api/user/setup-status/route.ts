import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { awardSetupGuideAchievements } from "@/lib/achievements"
import {
  buildSetupStatusPayload,
  setupStatusJsonResponse,
} from "@/lib/setup-guide-status-api"

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const payload = await buildSetupStatusPayload(session.user.id)
  if (!payload) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  return NextResponse.json(setupStatusJsonResponse(payload))
}

/** Awards setup-guide achievements when tasks are complete; returns fresh status. */
export async function POST() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const payload = await buildSetupStatusPayload(session.user.id)
  if (!payload) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const newlyAwarded = await awardSetupGuideAchievements(session.user.id, payload.setupFlags)
  return NextResponse.json(setupStatusJsonResponse(payload, { newlyAwarded }))
}
