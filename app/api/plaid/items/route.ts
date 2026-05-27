import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const rows = await prisma.plaidItem.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      institutionName: true,
      createdAt: true,
      accounts: {
        orderBy: { accountName: "asc" },
        select: {
          id: true,
          accountName: true,
          mask: true,
          type: true,
        },
      },
    },
  })

  return NextResponse.json({
    items: rows.map((row) => ({
      id: row.id,
      institutionName: row.institutionName,
      createdAt: row.createdAt.toISOString(),
      accounts: row.accounts,
    })),
  })
}
