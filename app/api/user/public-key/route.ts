import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { NextResponse } from "next/server"

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { publicKey: true },
  })

  return NextResponse.json({ publicKey: user?.publicKey ?? null })
}

export async function PUT(req: Request) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { publicKey } = await req.json()
  if (!publicKey || typeof publicKey !== "string") {
    return NextResponse.json({ error: "publicKey is required" }, { status: 400 })
  }

  await prisma.user.update({
    where: { id: session.user.id },
    data: { publicKey },
  })

  return NextResponse.json({ success: true })
}
