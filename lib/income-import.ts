import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db"
import { getBtcPriceForDate, usdToSats } from "@/lib/btc-price"
import {
  ENVELOPE_FUNDING_BATCH_KIND_FUND,
  TX_SOURCE_INCOME_IMPORT,
  TX_SOURCE_IRREGULAR_INCOME,
  TX_SOURCE_PAYCHECK,
} from "@/lib/constants"
import { ensureSystemSavingsEnvelope } from "@/lib/envelope-funding"
import { encryptFieldForUser } from "@/lib/server-encrypt"
import { todayUtcIso } from "@/lib/transaction-visibility"

export const INCOME_IMPORT_PAYEE_DEFAULT = "Your past income"

export const EXISTING_INCOME_SOURCES = [
  TX_SOURCE_PAYCHECK,
  TX_SOURCE_IRREGULAR_INCOME,
  TX_SOURCE_INCOME_IMPORT,
] as const

export interface IncomeImportEntry {
  periodKey: string
  amount: number
  source?: string
  splitCount?: number
}

export type ParsedPeriod =
  | { kind: "month"; year: number; month: number; periodKey: string }
  | { kind: "year"; year: number; periodKey: string }

const MONTH_KEY_RE = /^\d{4}-\d{2}$/
const YEAR_KEY_RE = /^\d{4}$/

export function parseIncomePeriodKey(periodKey: string): ParsedPeriod | null {
  if (MONTH_KEY_RE.test(periodKey)) {
    const [y, m] = periodKey.split("-").map(Number)
    if (m < 1 || m > 12) return null
    return { kind: "month", year: y, month: m, periodKey }
  }
  if (YEAR_KEY_RE.test(periodKey)) {
    const year = Number(periodKey)
    return { kind: "year", year, periodKey }
  }
  return null
}

export function currentMonthKeyUtc(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`
}

export function currentYearUtc(now = new Date()): number {
  return now.getUTCFullYear()
}

/** True when any import row targets the current month or year (envelope funding applies). */
export function entriesNeedMonthlyIncome(entries: readonly IncomeImportEntry[], now = new Date()): boolean {
  return entries.some((e) => isPeriodCurrent(e.periodKey, now))
}

/** True when the period is the current calendar month or year. */
export function isPeriodCurrent(periodKey: string, now = new Date()): boolean {
  const parsed = parseIncomePeriodKey(periodKey)
  if (!parsed) return false
  if (parsed.kind === "year") return parsed.year === currentYearUtc(now)
  return parsed.periodKey === currentMonthKeyUtc(now)
}

/** True when the period is after the current calendar month or year (not importable). */
export function isImportPeriodFuture(periodKey: string, now = new Date()): boolean {
  const parsed = parseIncomePeriodKey(periodKey)
  if (!parsed) return false
  if (parsed.kind === "year") return parsed.year > currentYearUtc(now)
  return parsed.periodKey > currentMonthKeyUtc(now)
}

/** Drop paycheck dates after today so annual/current-year imports cannot create future credits. */
export function filterImportDatesThroughToday(
  dates: readonly string[],
  now = new Date(),
): string[] {
  const today = todayUtcIso(now)
  return dates.filter((d) => d <= today)
}

/** Envelope funding on import applies to the current month only (not future slices of a year row). */
export function shouldFundEnvelopeSliceOnImport(
  periodKey: string,
  dateIso: string,
  now = new Date(),
): boolean {
  if (!isPeriodCurrent(periodKey, now)) return false
  const parsed = parseIncomePeriodKey(periodKey)
  if (!parsed) return false
  if (parsed.kind === "month") return true
  return dateIso.startsWith(currentMonthKeyUtc(now))
}

/** True when the period is the current month/year or later (envelope funding applies). */
export function isPeriodCurrentOrFuture(periodKey: string, now = new Date()): boolean {
  const parsed = parseIncomePeriodKey(periodKey)
  if (!parsed) return false
  if (parsed.kind === "year") return parsed.year >= currentYearUtc(now)
  return parsed.periodKey >= currentMonthKeyUtc(now)
}

export function entriesIncludeFuturePeriod(
  entries: readonly IncomeImportEntry[],
  now = new Date(),
): boolean {
  return entries.some((e) => isImportPeriodFuture(e.periodKey, now))
}

/** One import batch per user+period (overwrite on re-import). */
export function importBatchPeriodKey(userId: string, periodKey: string): string {
  return `import-${userId}-${periodKey}`
}

/** True for pre-stable amount-suffixed batches (`…-{amount}`), not other period stable keys. */
export function isLegacyImportBatchPeriodKey(
  periodKey: string,
  userId: string,
  importedPeriodKey: string,
): boolean {
  const batchKey = importBatchPeriodKey(userId, importedPeriodKey)
  if (!periodKey.startsWith(`${batchKey}-`)) return false
  const suffix = periodKey.slice(batchKey.length + 1)
  if (!suffix) return false

  // Annual import: stable month batches share the `${year}-` prefix (e.g. …-2023-01).
  if (YEAR_KEY_RE.test(importedPeriodKey) && /^\d{2}$/.test(suffix)) {
    const month = Number(suffix)
    if (month >= 1 && month <= 12) return false
  }

  return /^\d+(\.\d{1,2})?$/.test(suffix)
}

export function incomeImportBatchPeriodMatches(
  batchPeriodKey: string | null | undefined,
  importedPeriodKey: string,
): boolean {
  if (!batchPeriodKey) return false
  if (batchPeriodKey.endsWith(`-${importedPeriodKey}`)) return true
  const marker = `-${importedPeriodKey}-`
  const markerIndex = batchPeriodKey.lastIndexOf(marker)
  if (markerIndex < 0) return false
  const suffix = batchPeriodKey.slice(markerIndex + marker.length)

  // Annual imports and stable month imports share the year prefix; keep their
  // overwrite baselines independent unless the suffix is an old amount key.
  if (YEAR_KEY_RE.test(importedPeriodKey) && /^\d{2}$/.test(suffix)) {
    const month = Number(suffix)
    if (month >= 1 && month <= 12) return false
  }

  return /^\d+(\.\d{1,2})?$/.test(suffix)
}

/** Remove prior income-import batch for a period (Savings credits + allocation legs). */
export async function deletePriorImportForPeriod(
  tx: Prisma.TransactionClient,
  userId: string,
  periodKey: string,
): Promise<void> {
  await resetImportBatchForPeriod(tx, userId, periodKey)
}

/**
 * Reuse the stable import batch for user+period: clear its transactions, delete legacy
 * amount-suffixed batches, and return the batch row (avoids FK races on concurrent imports).
 */
export async function resetImportBatchForPeriod(
  tx: Prisma.TransactionClient,
  userId: string,
  periodKey: string,
): Promise<{ id: string }> {
  const batchKey = importBatchPeriodKey(userId, periodKey)
  const legacyPrefix = `${batchKey}-`

  const legacyBatches = (
    await tx.envelopeFundingBatch.findMany({
      where: {
        userId,
        kind: ENVELOPE_FUNDING_BATCH_KIND_FUND,
        periodKey: { startsWith: legacyPrefix },
      },
      select: { id: true, periodKey: true },
    })
  ).filter((batch) => isLegacyImportBatchPeriodKey(batch.periodKey, userId, periodKey))

  for (const batch of legacyBatches) {
    await tx.transaction.deleteMany({ where: { fundingBatchId: batch.id } })
    await tx.envelopeFundingBatch.delete({ where: { id: batch.id } })
  }

  const stableWhere = {
    userId_periodKey_kind: {
      userId,
      periodKey: batchKey,
      kind: ENVELOPE_FUNDING_BATCH_KIND_FUND,
    },
  } as const

  let stable = await tx.envelopeFundingBatch.findUnique({
    where: stableWhere,
    select: { id: true },
  })

  if (!stable) {
    try {
      stable = await tx.envelopeFundingBatch.create({
        data: {
          userId,
          periodKey: batchKey,
          kind: ENVELOPE_FUNDING_BATCH_KIND_FUND,
        },
        select: { id: true },
      })
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        stable = await tx.envelopeFundingBatch.findUnique({
          where: stableWhere,
          select: { id: true },
        })
        if (!stable) throw e
      } else {
        throw e
      }
    }
  }

  await tx.transaction.deleteMany({ where: { fundingBatchId: stable.id } })
  return stable
}

export function resolveImportPayDay(payDays: readonly number[]): number {
  if (payDays.length > 0) {
    const day = payDays[0]!
    return Math.min(28, Math.max(1, day))
  }
  return 15
}

function clampDay(year: number, month: number, day: number): string {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const d = Math.min(day, lastDay)
  return `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`
}

/** Spread synthetic paycheck dates across a period. */
export function distributeImportDates(params: {
  periodKey: string
  payDay: number
  splitCount: number
}): string[] {
  const parsed = parseIncomePeriodKey(params.periodKey)
  if (!parsed) return []
  const count = Math.max(1, Math.min(52, Math.floor(params.splitCount)))
  const dates: string[] = []

  if (parsed.kind === "month") {
    if (count === 1) {
      dates.push(clampDay(parsed.year, parsed.month, params.payDay))
      return dates
    }
    const lastDay = new Date(Date.UTC(parsed.year, parsed.month, 0)).getUTCDate()
    for (let i = 0; i < count; i++) {
      const day = Math.min(lastDay, Math.max(1, Math.round(((i + 1) / (count + 1)) * lastDay)))
      dates.push(clampDay(parsed.year, parsed.month, day))
    }
    return dates
  }

  if (count === 1) {
    dates.push(clampDay(parsed.year, 1, params.payDay))
    return dates
  }

  for (let i = 0; i < count; i++) {
    const month = Math.min(12, Math.max(1, Math.round(((i + 1) / (count + 1)) * 12)))
    dates.push(clampDay(parsed.year, month, params.payDay))
  }
  return dates
}

/** Split a gross amount into N paychecks (2-decimal USD, sums to gross). */
export function splitAmountAcrossChecks(grossUsd: number, count: number): number[] {
  const n = Math.max(1, Math.floor(count))
  if (n === 1) return [Math.round(grossUsd * 100) / 100]
  const totalCents = Math.round(grossUsd * 100)
  const base = Math.floor(totalCents / n)
  let remainder = totalCents - base * n
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    let cents = base
    if (remainder > 0) {
      cents += 1
      remainder -= 1
    }
    out.push(cents / 100)
  }
  return out
}

export function periodBoundsForExistingIncome(periodKey: string): { start: Date; end: Date } | null {
  const parsed = parseIncomePeriodKey(periodKey)
  if (!parsed) return null
  if (parsed.kind === "year") {
    return {
      start: new Date(Date.UTC(parsed.year, 0, 1, 0, 0, 0, 0)),
      end: new Date(Date.UTC(parsed.year + 1, 0, 1, 0, 0, 0, 0)),
    }
  }
  return {
    start: new Date(Date.UTC(parsed.year, parsed.month - 1, 1, 0, 0, 0, 0)),
    end: new Date(Date.UTC(parsed.year, parsed.month, 1, 0, 0, 0, 0)),
  }
}

export interface IncomeImportTransactionRow {
  type: string
  source?: string | null
  amount: number
  date: string
  excludeFromMainHistory?: boolean
  fundingBatchPeriodKey?: string | null
}

/** Sum prior income-import credits in a period (overwrite baseline for review UI). */
export function sumPriorIncomeImportForPeriod(
  transactions: readonly IncomeImportTransactionRow[],
  periodKey: string,
): number {
  const bounds = periodBoundsForExistingIncome(periodKey)
  if (!bounds) return 0
  const startMs = bounds.start.getTime()
  const endMs = bounds.end.getTime()
  return transactions
    .filter((t) => {
      if (t.type !== "credit" || t.excludeFromMainHistory) return false
      if (t.source !== TX_SOURCE_INCOME_IMPORT) return false
      if (t.fundingBatchPeriodKey !== undefined) {
        return incomeImportBatchPeriodMatches(t.fundingBatchPeriodKey, periodKey)
      }
      const d = new Date(`${t.date}T12:00:00.000Z`).getTime()
      return d >= startMs && d < endMs
    })
    .reduce((sum, t) => sum + t.amount, 0)
}

const EMPTY_TAGS = "[]"

export interface ProcessIncomeImportInput {
  userId: string
  publicKey: string | null
  monthlyIncome: number
  payDays: number[]
  entries: IncomeImportEntry[]
}

async function prefetchBtcPricesForImportEntries(
  entries: IncomeImportEntry[],
  payDay: number,
): Promise<Map<string, number | null>> {
  const dateIsos = new Set<string>()
  for (const entry of entries) {
    const amount = Math.round(entry.amount * 100) / 100
    if (!Number.isFinite(amount) || amount <= 0) continue
    const parsed = parseIncomePeriodKey(entry.periodKey)
    if (!parsed) continue
    const splitCount = parsed.kind === "year" ? Math.max(1, entry.splitCount ?? 1) : 1
    for (const dateIso of distributeImportDates({ periodKey: entry.periodKey, payDay, splitCount })) {
      dateIsos.add(dateIso)
    }
  }

  const prices = new Map<string, number | null>()
  await Promise.all(
    [...dateIsos].map(async (dateIso) => {
      prices.set(dateIso, await getBtcPriceForDate(dateIso))
    }),
  )
  return prices
}

/** Last entry wins for duplicate periodKeys (matches client Map staging). */
export function dedupeImportEntriesByPeriod(
  entries: readonly IncomeImportEntry[],
): IncomeImportEntry[] {
  const byPeriod = new Map<string, IncomeImportEntry>()
  for (const entry of entries) {
    byPeriod.set(entry.periodKey, entry)
  }
  return [...byPeriod.values()]
}

/** Import historical or current income entries. Returns transactions created. */
export async function processIncomeImport(input: ProcessIncomeImportInput): Promise<number> {
  const pk = input.publicKey?.trim()
  if (!pk) return 0

  const entries = dedupeImportEntriesByPeriod(input.entries).filter(
    (e) => !isImportPeriodFuture(e.periodKey),
  )
  if (entries.length === 0) return 0
  const mi = input.monthlyIncome
  const now = new Date()
  const needsMonthlyIncome = entriesNeedMonthlyIncome(entries, now)
  if (!Number.isFinite(mi) || mi < 0) return 0
  if (needsMonthlyIncome && mi <= 0) return 0

  const savings = await ensureSystemSavingsEnvelope(input.userId)
  const payDay = resolveImportPayDay(input.payDays)

  let totalCreated = 0
  const btcPrices = await prefetchBtcPricesForImportEntries(entries, payDay)

  await prisma.$transaction(async (tx) => {
    for (const entry of entries) {
      const amount = Math.round(entry.amount * 100) / 100
      if (!Number.isFinite(amount) || amount <= 0) continue

      const parsed = parseIncomePeriodKey(entry.periodKey)
      if (!parsed) continue

      const batch = await resetImportBatchForPeriod(tx, input.userId, entry.periodKey)

      const label = entry.source?.trim() || INCOME_IMPORT_PAYEE_DEFAULT
      const encPayee = encryptFieldForUser(label, pk)
      if (!encPayee) continue

      const splitCount = parsed.kind === "year" ? Math.max(1, entry.splitCount ?? 1) : 1
      const dates = filterImportDatesThroughToday(
        distributeImportDates({ periodKey: entry.periodKey, payDay, splitCount }),
        now,
      )
      if (dates.length === 0) continue
      const amounts = splitAmountAcrossChecks(amount, dates.length)

      for (let i = 0; i < dates.length; i++) {
        const dateIso = dates[i]!
        const sliceAmount = amounts[i] ?? 0
        if (sliceAmount <= 0) continue

        const btcPrice = btcPrices.get(dateIso) ?? null
        const fundingDate = new Date(`${dateIso}T12:00:00.000Z`)

        await tx.transaction.create({
          data: {
            userId: input.userId,
            envelopeId: savings.id,
            date: fundingDate,
            payee: encPayee,
            amount: sliceAmount,
            type: "credit",
            tags: EMPTY_TAGS,
            source: TX_SOURCE_INCOME_IMPORT,
            satsAmount: btcPrice ? usdToSats(sliceAmount, btcPrice) : null,
            excludeFromMainHistory: false,
            fundingBatchId: batch.id,
          },
        })
        totalCreated++
      }
    }
  })

  return totalCreated
}
