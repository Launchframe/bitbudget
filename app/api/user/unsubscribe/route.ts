import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import {
  type CommunicationPreferenceKey,
  COMMUNICATION_PREFERENCE_KEYS,
  communicationPreferenceForCategory,
  isCommunicationPreferenceKey,
} from "@/lib/communication-preferences"

function parsePreference(raw: string | null): CommunicationPreferenceKey | "all" | null {
  if (raw === "all") return "all"
  if (isCommunicationPreferenceKey(raw)) return raw
  return null
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token")?.trim()
  const rawPreference = req.nextUrl.searchParams.get("preference") ?? req.nextUrl.searchParams.get("category")
  const preference = parsePreference(rawPreference)

  if (!token || !preference) {
    return NextResponse.json({ error: "Invalid unsubscribe link" }, { status: 400 })
  }

  const user = await prisma.user.findUnique({
    where: { emailUnsubscribeToken: token },
    select: { id: true },
  })

  if (!user) {
    return NextResponse.json({ error: "Invalid unsubscribe link" }, { status: 404 })
  }

  const preferences =
    preference === "all"
      ? Object.fromEntries(
          COMMUNICATION_PREFERENCE_KEYS.map((key) => [communicationPreferenceForCategory(key).field, false]),
        )
      : { [communicationPreferenceForCategory(preference).field]: false }

  await prisma.user.update({
    where: { id: user.id },
    data: preferences,
  })

  return NextResponse.redirect(new URL("/auth?unsubscribed=1", req.nextUrl.origin))
}
