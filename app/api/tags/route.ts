import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const tags = await prisma.tag.findMany({
    where: { userId: session.user.id },
    orderBy: { name: "asc" },
  })

  return NextResponse.json(tags.map(tag => ({ id: tag.id, name: tag.name })))
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { name } = await req.json()
  if (typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 })
  }

  const trimmed = name.trim()
  const existing = await prisma.tag.findFirst({
    where: { userId: session.user.id, name: trimmed },
  })
  if (existing) {
    return NextResponse.json({ id: existing.id, name: existing.name })
  }

  const tag = await prisma.tag.create({
    data: {
      userId: session.user.id,
      name: trimmed,
    },
  })

  return NextResponse.json({ id: tag.id, name: tag.name }, { status: 201 })
}

export async function DELETE(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { searchParams } = req.nextUrl
  const id = searchParams.get("id")
  if (!id) {
    return NextResponse.json({ error: "Tag ID required" }, { status: 400 })
  }

  const existing = await prisma.tag.findFirst({
    where: { id, userId: session.user.id },
  })
  if (!existing) {
    return NextResponse.json({ error: "Tag not found" }, { status: 404 })
  }

  await prisma.tag.delete({ where: { id } })
  return NextResponse.json({ success: true })
}
