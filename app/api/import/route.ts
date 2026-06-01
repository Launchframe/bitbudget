import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { getBtcPriceForDate, usdToSats } from "@/lib/btc-price"
import { PRESET_ENVELOPE_COLORS } from "@/lib/constants"
import { suggestIcon } from "@/lib/envelope-icon-suggest"
import type { TransactionSource } from "@/lib/data"

const ENVELOPE_COLORS = PRESET_ENVELOPE_COLORS
const ALLOWED_IMPORT_SOURCES = new Set<TransactionSource>(["manual", "csv_import", "statement_import"])

interface ImportedTransaction {
  date: string
  payee: string
  amount: number
  type: string
  envelopeName: string
  notes: string | null
  /** Client-computed HMAC fingerprint for idempotent imports (optional). */
  dedupeKey?: string
  /** Optional source tag written to the Transaction row. Defaults to batch or csv_import. */
  source?: string
  /** When present and valid, bypasses envelopeMapping name resolution entirely. */
  envelopeId?: string
}

const SKIP = "__skip__"
const CSV_PREFIX = "__csv__:"
const NEW_ENVELOPE = "__new__"
/** Exact pattern produced by `makeDedupeKeyComputer`: 128-bit lowercase hex. */
const DEDUPE_KEY_RE = /^[0-9a-f]{32}$/

// Each request is a chunk from the client; cap duration generously as a safety net.
export const maxDuration = 60

function isAllowedImportSource(value: unknown): value is TransactionSource {
  return typeof value === "string" && ALLOWED_IMPORT_SOURCES.has(value as TransactionSource)
}

function isValidImportedTransaction(value: unknown): value is ImportedTransaction {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false
  const txn = value as ImportedTransaction
  return (
    typeof txn.date === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(txn.date) &&
    typeof txn.payee === "string" &&
    typeof txn.amount === "number" &&
    Number.isFinite(txn.amount) &&
    txn.amount > 0 &&
    (txn.type === "expense" || txn.type === "credit") &&
    typeof txn.envelopeName === "string" &&
    txn.envelopeName.trim() !== "" &&
    (txn.notes === null || typeof txn.notes === "string") &&
    (txn.envelopeId === undefined || typeof txn.envelopeId === "string")
  )
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await req.json() as {
    transactions: ImportedTransaction[]
    envelopeMapping: Record<string, string>
    /** Optional source tag applied to every transaction in this batch. */
    source?: string
    /** Encrypted institution name (ciphertext). Stored in batch config; never read server-side. */
    institutionName?: string
    /** Date range of the statement being imported. */
    dateRange?: { from: string; to: string }
    /** Parsed statement format identifier. */
    statementFormat?: string
  }

  const { transactions, envelopeMapping, source: batchSource, institutionName, dateRange, statementFormat } = body

  if (!transactions || !Array.isArray(transactions) || transactions.length === 0) {
    return NextResponse.json({ error: "No transactions provided" }, { status: 400 })
  }

  if (batchSource !== undefined && !isAllowedImportSource(batchSource)) {
    return NextResponse.json({ error: "Invalid source field." }, { status: 400 })
  }
  if (typeof envelopeMapping !== "object" || envelopeMapping === null || Array.isArray(envelopeMapping)) {
    return NextResponse.json({ error: "Invalid envelope mapping." }, { status: 400 })
  }
  for (const txn of transactions) {
    if (!isValidImportedTransaction(txn)) {
      return NextResponse.json({ error: "Invalid transaction row." }, { status: 400 })
    }
    if (txn.source !== undefined && !isAllowedImportSource(txn.source)) {
      return NextResponse.json({ error: "Invalid source field." }, { status: 400 })
    }
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
  const userEnvelopeIds = new Set(userEnvelopes.map(e => e.id))

  let envelopeCount = userEnvelopes.length
  const resolvedMapping: Record<string, string> = {}
  const newEnvelopes: string[] = []

  for (const [csvName, target] of Object.entries(envelopeMapping)) {
    if (typeof target !== "string") {
      return NextResponse.json({ error: "Invalid envelope mapping." }, { status: 400 })
    }
    if (target === SKIP) {
      resolvedMapping[csvName.toLowerCase()] = SKIP
    } else if (target.startsWith(CSV_PREFIX)) {
      // Deferred to second pass
    } else if (target === NEW_ENVELOPE) {
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
      if (!userEnvelopeIds.has(target)) {
        return NextResponse.json({ error: "Invalid envelope mapping." }, { status: 400 })
      }
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

  // Create a funding batch for statement imports to enable undo
  let fundingBatchId: string | null = null
  if (batchSource === "statement_import") {
    const periodKey = `stmt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const batchConfig = {
      institutionName: institutionName ?? null,
      dateFrom: dateRange?.from ?? null,
      dateTo: dateRange?.to ?? null,
      format: statementFormat ?? null,
      transactionCount: transactions.length,
    }
    const batch = await prisma.envelopeFundingBatch.create({
      data: {
        userId,
        periodKey,
        kind: "statement_import",
        config: batchConfig,
      },
    })
    fundingBatchId = batch.id
  }

  let skipped = 0

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
    fundingBatchId?: string | null
  }[] = []

  for (const txn of transactions) {
    const lowerName = txn.envelopeName.toLowerCase()

    if (resolvedMapping[lowerName] === SKIP) { skipped++; continue }

    const rawKey = typeof txn.dedupeKey === "string" && txn.dedupeKey.length > 0
      ? txn.dedupeKey
      : null

    let envelopeId: string | undefined =
      txn.envelopeId && userEnvelopeIds.has(txn.envelopeId) ? txn.envelopeId : undefined

    if (!envelopeId) {
      envelopeId = resolvedMapping[lowerName] ?? envelopeByName[lowerName]
    }

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
    const txnSource = txn.source ?? batchSource ?? "csv_import"

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
      source: txnSource,
      dedupeKey: rawKey,
      ...(fundingBatchId ? { fundingBatchId } : {}),
    })
  }

  const { count: created } = await prisma.transaction.createMany({
    data,
    skipDuplicates: true,
  })

  const duplicates = data.length - created

  return NextResponse.json({
    imported: created,
    skipped,
    duplicates,
    newEnvelopes,
    totalRows: transactions.length,
    importBatchId: fundingBatchId,
  })
}
