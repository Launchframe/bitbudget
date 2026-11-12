import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { depositoryCashUsd } from "@/lib/plaid-ledger"

function decimalToNumber(value: { toNumber: () => number } | number | null): number | null {
  if (value == null) return null
  if (typeof value === "number") return Number.isFinite(value) ? value : null
  const n = value.toNumber()
  return Number.isFinite(n) ? n : null
}

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
          currentBalance: true,
          availableBalance: true,
          isoCurrencyCode: true,
          balanceUpdatedAt: true,
        },
      },
    },
  })

  return NextResponse.json({
    items: rows.map((row) => {
      const accounts = row.accounts.map((account) => ({
        id: account.id,
        accountName: account.accountName,
        mask: account.mask,
        type: account.type,
        currentBalance: decimalToNumber(account.currentBalance),
        availableBalance: decimalToNumber(account.availableBalance),
        isoCurrencyCode: account.isoCurrencyCode,
        balanceUpdatedAt: account.balanceUpdatedAt?.toISOString() ?? null,
      }))
      return {
        id: row.id,
        institutionName: row.institutionName,
        createdAt: row.createdAt.toISOString(),
        depositoryCashUsd: depositoryCashUsd(accounts),
        accounts,
      }
    }),
  })
}
