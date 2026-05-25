import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import {
  COMMUNICATION_PREFERENCE_KEYS,
  communicationPreferenceForKey,
  parseUnsubscribePreference,
} from "@/lib/communication-preferences"

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token")?.trim()
  const rawPreference = req.nextUrl.searchParams.get("preference") ?? req.nextUrl.searchParams.get("category")
  const preference = parseUnsubscribePreference(rawPreference)

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
          COMMUNICATION_PREFERENCE_KEYS.map((key) => [communicationPreferenceForKey(key).field, false]),
        )
      : { [communicationPreferenceForKey(preference).field]: false }

  await prisma.user.update({
    where: { id: user.id },
    data: preferences,
  })

  return NextResponse.redirect(new URL("/auth?unsubscribed=1", req.nextUrl.origin))
}
