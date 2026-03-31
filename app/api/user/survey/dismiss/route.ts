import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let body: { type?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const t = body.type === "never" ? "never" : "later"

  const row = await prisma.survey.upsert({
    where: { userId: session.user.id },
    create: {
      userId: session.user.id,
      triggerType: "general",
      dismissedAt: new Date(),
      dismissType: t,
      currentStep: 1,
    },
    update: {
      dismissedAt: new Date(),
      dismissType: t,
    },
  })

  return NextResponse.json({ survey: row })
}
