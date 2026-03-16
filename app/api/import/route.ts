import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { getBtcPriceForDate, usdToSats } from "@/lib/btc-price"

const ENVELOPE_COLORS = ["#F7931A", "#3B82F6", "#10B981", "#8B5CF6", "#EF4444", "#EAB308", "#EC4899", "#06B6D4"]

interface ImportedTransaction {
  date: string
  payee: string
  amount: number
  type: string
  envelopeName: string
  notes: string | null
}

const SKIP = "__skip__"
const CSV_PREFIX = "__csv__:"

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await req.json() as {
    transactions: ImportedTransaction[]
    envelopeMapping: Record<string, string>
  }

  const { transactions, envelopeMapping } = body

  if (!transactions || !Array.isArray(transactions) || transactions.length === 0) {
    return NextResponse.json({ error: "No transactions provided" }, { status: 400 })
  }

  const userId = session.user.id

  const userEnvelopes = await prisma.envelope.findMany({
    where: { userId },
  })
  const envelopeByName: Record<string, string> = {}
  for (const e of userEnvelopes) {
    envelopeByName[e.name.toLowerCase()] = e.id
  }

  let envelopeCount = userEnvelopes.length
  const resolvedMapping: Record<string, string> = {}

  for (const [csvName, target] of Object.entries(envelopeMapping)) {
    if (target === SKIP) {
      resolvedMapping[csvName.toLowerCase()] = SKIP
    } else if (target.startsWith(CSV_PREFIX)) {
      // Deferred to second pass
    } else if (target === "__new__") {
      const existing = envelopeByName[csvName.toLowerCase()]
      if (existing) {
        resolvedMapping[csvName.toLowerCase()] = existing
      } else {
        const newEnv = await prisma.envelope.create({
          data: {
            userId,
            name: csvName,
            monthlyAllotment: 0,
            color: ENVELOPE_COLORS[envelopeCount % ENVELOPE_COLORS.length],
          },
        })
        resolvedMapping[csvName.toLowerCase()] = newEnv.id
        envelopeByName[csvName.toLowerCase()] = newEnv.id
        envelopeCount++
      }
    } else {
      resolvedMapping[csvName.toLowerCase()] = target
    }
  }

  for (const [csvName, target] of Object.entries(envelopeMapping)) {
    if (target.startsWith(CSV_PREFIX)) {
      const refName = target.slice(CSV_PREFIX.length).toLowerCase()
      const resolved = resolvedMapping[refName] ?? envelopeByName[refName]
      if (resolved && resolved !== SKIP) {
        resolvedMapping[csvName.toLowerCase()] = resolved
      }
    }
  }

  let created = 0
  let skipped = 0
  const newEnvelopes: string[] = []

  for (const txn of transactions) {
    const lowerName = txn.envelopeName.toLowerCase()

    if (resolvedMapping[lowerName] === SKIP) { skipped++; continue }

    let envelopeId = resolvedMapping[lowerName] ?? envelopeByName[lowerName]
    if (!envelopeId) {
      const newEnv = await prisma.envelope.create({
        data: {
          userId,
          name: txn.envelopeName,
          monthlyAllotment: 0,
          color: ENVELOPE_COLORS[envelopeCount % ENVELOPE_COLORS.length],
        },
      })
      envelopeId = newEnv.id
      envelopeByName[lowerName] = envelopeId
      envelopeCount++
      newEnvelopes.push(txn.envelopeName)
    }

    const btcPrice = await getBtcPriceForDate(txn.date)

    await prisma.transaction.create({
      data: {
        userId,
        envelopeId,
        date: new Date(txn.date),
        payee: txn.payee,
        amount: txn.amount,
        type: txn.type,
        notes: txn.notes,
        tags: "[]",
        satsAmount: btcPrice ? usdToSats(txn.amount, btcPrice) : null,
      },
    })
    created++
  }

  return NextResponse.json({
    imported: created,
    skipped,
    newEnvelopes,
    totalRows: transactions.length,
  })
}
