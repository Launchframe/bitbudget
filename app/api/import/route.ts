import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { getBtcPriceForDate, usdToSats } from "@/lib/btc-price"
import { PRESET_ENVELOPE_COLORS } from "@/lib/constants"
import { suggestIcon } from "@/lib/envelope-icon-suggest"

const ENVELOPE_COLORS = PRESET_ENVELOPE_COLORS

interface ImportedTransaction {
  date: string
  payee: string
  amount: number
  type: string
  envelopeName: string
  notes: string | null
  /** Client-computed HMAC fingerprint for idempotent imports (optional). */
  dedupeKey?: string
}

const SKIP = "__skip__"
const CSV_PREFIX = "__csv__:"
/** Exact pattern produced by `makeDedupeKeyComputer`: 128-bit lowercase hex. */
const DEDUPE_KEY_RE = /^[0-9a-f]{32}$/

// Each request is a chunk from the client; cap duration generously as a safety net.
export const maxDuration = 60

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

  // Validate every optional dedupeKey before any DB write. Envelope creation happens
  // below, so malformed chunks must fail without leaving empty CSV envelopes behind.
  for (const txn of transactions) {
    const rawKey = typeof txn.dedupeKey === "string" && txn.dedupeKey.length > 0
      ? txn.dedupeKey
      : null
    if (rawKey !== null && !DEDUPE_KEY_RE.test(rawKey)) {
      return NextResponse.json(
        { error: "Invalid dedupeKey: must be exactly 32 lowercase hex characters" },
        { status: 400 },
      )
    }
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
  const newEnvelopes: string[] = []

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
            icon: suggestIcon(csvName),
          },
        })
        resolvedMapping[csvName.toLowerCase()] = newEnv.id
        envelopeByName[csvName.toLowerCase()] = newEnv.id
        envelopeCount++
        newEnvelopes.push(csvName)
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

  let skipped = 0

  // Memoize BTC price lookups by date so repeated dates don't re-query (3 reads each).
  const priceByDate = new Map<string, number | null>()
  const priceForDate = async (date: string): Promise<number | null> => {
    if (priceByDate.has(date)) return priceByDate.get(date) ?? null
    const price = await getBtcPriceForDate(date)
    priceByDate.set(date, price)
    return price
  }

  const data: {
    userId: string
    envelopeId: string
    date: Date
    payee: string
    amount: number
    type: string
    notes: string | null
    tags: string
    satsAmount: number | null
    source: string
    dedupeKey: string | null
  }[] = []

  for (const txn of transactions) {
    const lowerName = txn.envelopeName.toLowerCase()

    if (resolvedMapping[lowerName] === SKIP) { skipped++; continue }

    const rawKey = typeof txn.dedupeKey === "string" && txn.dedupeKey.length > 0
      ? txn.dedupeKey
      : null

    let envelopeId = resolvedMapping[lowerName] ?? envelopeByName[lowerName]
    if (!envelopeId) {
      const newEnv = await prisma.envelope.create({
        data: {
          userId,
          name: txn.envelopeName,
          monthlyAllotment: 0,
          color: ENVELOPE_COLORS[envelopeCount % ENVELOPE_COLORS.length],
          icon: suggestIcon(txn.envelopeName),
        },
      })
      envelopeId = newEnv.id
      envelopeByName[lowerName] = envelopeId
      envelopeCount++
      newEnvelopes.push(txn.envelopeName)
    }

    const btcPrice = await priceForDate(txn.date)

    data.push({
      userId,
      envelopeId,
      date: new Date(txn.date),
      payee: txn.payee,
      amount: txn.amount,
      type: txn.type,
      notes: txn.notes,
      tags: "[]",
      satsAmount: btcPrice ? usdToSats(txn.amount, btcPrice) : null,
      source: "csv_import",
      dedupeKey: rawKey,
    })
  }

  // Idempotent bulk insert: rows whose (userId, dedupeKey) already exists are skipped via the
  // partial unique index. Rows with a null dedupeKey are never deduped (always inserted).
  const { count: created } = await prisma.transaction.createMany({
    data,
    skipDuplicates: true,
  })

  // Only dedupeKey-bearing rows can be skipped as duplicates; null-key rows always insert.
  const duplicates = data.length - created

  return NextResponse.json({
    imported: created,
    skipped,
    duplicates,
    newEnvelopes,
    totalRows: transactions.length,
  })
}
