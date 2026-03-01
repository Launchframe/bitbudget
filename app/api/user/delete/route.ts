import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"

export async function DELETE() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // Cascade deletes handle accounts, sessions, envelopes, transactions, tags
  await prisma.user.delete({ where: { id: session.user.id } })

  return NextResponse.json({ deleted: true })
}
