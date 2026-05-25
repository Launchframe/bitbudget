import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { referralStatsForUser } from "@/lib/referral"
import { refereeTrialMonthsForReferrerSubscription, resolveEffectiveTier } from "@/lib/subscription"
import {
  SAVINGS_EXPERIENCE_DISMISSED,
  SAVINGS_EXPERIENCE_ENGAGED,
  SWEEP_POLICY_CAPPED,
  SWEEP_POLICY_CARRY_FORWARD,
  SWEEP_POLICY_RESET,
} from "@/lib/constants"
import { assertPayCadencePersistable, isDailyPayCadenceAllowed } from "@/lib/pay-cadence-server"
import { PAYDAY_LAST_OF_MONTH } from "@/lib/payday-cadence"
import { validateDecimal12_2, validateDecimal4_2Positive } from "@/lib/decimal-validation"

/** JSON body for PUT: only these keys are read; extra keys are ignored. */
type UserSettingsPutBody = Partial<{
  monthlyIncome: number
  payCadence: string
  onboardingComplete: boolean
  btcDisplayUnit: string
  opportunityCostEnabled: boolean
  receiptInboxToken: string | null
  name: string | null
  payDays: number[]
  payDayOfWeek: number | null
  lastPaydayAt: string | null
  estimatedAnnualIncome: number | null
  sweepDefaultPolicy: string
  sweepDefaultCapMultiplier: number | null
  savingsExperience: string
}>

const ALLOWED_PAY_CADENCES = new Set([
  "monthly",
  "bimonthly",
  "weekly",
  "biweekly",
  "irregular",
  "mixed",
  "daily",
])

const ALLOWED_SWEEP_POLICIES = new Set([
  SWEEP_POLICY_RESET,
  SWEEP_POLICY_CARRY_FORWARD,
  SWEEP_POLICY_CAPPED,
])

const ALLOWED_SAVINGS_EXPERIENCES = new Set([
  SAVINGS_EXPERIENCE_ENGAGED,
  SAVINGS_EXPERIENCE_DISMISSED,
])

const ALLOWED_SETTINGS_PUT_FIELDS = [
  "monthlyIncome",
  "payCadence",
  "onboardingComplete",
  "btcDisplayUnit",
  "opportunityCostEnabled",
  "receiptInboxToken",
  "name",
  "payDays",
  "payDayOfWeek",
  "lastPaydayAt",
  "estimatedAnnualIncome",
  "sweepDefaultPolicy",
  "sweepDefaultCapMultiplier",
  "savingsExperience",
] as const satisfies readonly (keyof UserSettingsPutBody)[]

const userSettingsSelect = {
  monthlyIncome: true,
  payCadence: true,
  payDays: true,
  payDayOfWeek: true,
  lastPaydayAt: true,
  estimatedAnnualIncome: true,
  sweepDefaultPolicy: true,
  sweepDefaultCapMultiplier: true,
  savingsExperience: true,
  onboardingComplete: true,
  btcDisplayUnit: true,
  opportunityCostEnabled: true,
  nostrPubkey: true,
  encryptedPrivacyKey: true,
  privacyKeySalt: true,
  receiptInboxToken: true,
  name: true,
  email: true,
  subscriptionTier: true,
  role: true,
  premiumGratisUntil: true,
  premiumTrialUntil: true,
  _count: { select: { transactions: true } },
} as const

function serializeDecimal(value: Prisma.Decimal | null | undefined): number | null {
  if (value == null) return null
  return Number(value)
}

function serializeUserSettings(user: {
  lastPaydayAt: Date | null
  estimatedAnnualIncome: Prisma.Decimal | null
  sweepDefaultCapMultiplier: Prisma.Decimal | null
  premiumGratisUntil: Date | null
  premiumTrialUntil: Date | null
  _count: { transactions: number }
  [key: string]: unknown
}) {
  const { _count, premiumGratisUntil, premiumTrialUntil, ...rest } = user
  return {
    ...rest,
    lastPaydayAt: rest.lastPaydayAt instanceof Date ? rest.lastPaydayAt.toISOString() : rest.lastPaydayAt ?? null,
    estimatedAnnualIncome: serializeDecimal(rest.estimatedAnnualIncome as Prisma.Decimal | null),
    sweepDefaultCapMultiplier: serializeDecimal(rest.sweepDefaultCapMultiplier as Prisma.Decimal | null),
    premiumGratisUntil: premiumGratisUntil?.toISOString() ?? null,
    premiumTrialUntil: premiumTrialUntil?.toISOString() ?? null,
    transactionCount: _count.transactions,
  }
}

function parsePayDays(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null
  const days: number[] = []
  for (const item of value) {
    if (
      typeof item !== "number" ||
      !Number.isInteger(item) ||
      item < 1 ||
      (item > 31 && item !== PAYDAY_LAST_OF_MONTH)
    ) {
      return null
    }
    days.push(item)
  }
  return days
}

function parseOptionalIsoDate(value: unknown): Date | null | "invalid" {
  if (value === null) return null
  if (typeof value !== "string") return "invalid"
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return "invalid"
  return parsed
}

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: userSettingsSelect,
  })

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const effectiveTier = resolveEffectiveTier({
    subscriptionTier: user.subscriptionTier,
    premiumGratisUntil: user.premiumGratisUntil,
    premiumTrialUntil: user.premiumTrialUntil,
  })

  const refereeReferralRow = await prisma.referral.findUnique({
    where: { refereeId: session.user.id },
    include: { referrer: { select: { subscriptionTier: true } } },
  })
  const isRefereePendingBankLink = refereeReferralRow?.status === "accepted"
  const referralRefereeTrialMonths =
    isRefereePendingBankLink && refereeReferralRow?.referrer
      ? refereeTrialMonthsForReferrerSubscription(refereeReferralRow.referrer.subscriptionTier)
      : null

  let referralPayload: Record<string, unknown> | null = null
  if (user.onboardingComplete) {
    const stats = await referralStatsForUser(session.user.id, new Date(), {
      premiumGratisUntil: user.premiumGratisUntil,
      premiumTrialUntil: user.premiumTrialUntil,
      subscriptionTier: user.subscriptionTier,
    })
    referralPayload = {
      code: stats.activeCode?.code ?? null,
      codeExpiresAt: stats.activeCode?.expiresAt.toISOString() ?? null,
      lastCode: stats.lastCode
        ? {
            code: stats.lastCode.code,
            expiresAt: stats.lastCode.expiresAt.toISOString(),
            usedCount: stats.lastCode.usedCount,
            active: stats.lastCode.active,
          }
        : null,
      referralCount: stats.referralCount,
      activatedCount: stats.activatedCount,
      premiumGratisUntil: stats.premiumGratisUntil?.toISOString() ?? null,
      premiumTrialUntil: stats.premiumTrialUntil?.toISOString() ?? null,
    }
  }

  return NextResponse.json({
    ...serializeUserSettings(user),
    effectiveTier,
    referralRefereePendingBankLink: isRefereePendingBankLink,
    referralRefereeTrialMonths,
    referral: referralPayload,
    dailyCadenceAllowed: isDailyPayCadenceAllowed(),
  })
}

export async function PUT(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const userId = session.user.id

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return NextResponse.json({ error: "Expected a JSON object" }, { status: 400 })
  }
  const body = raw as UserSettingsPutBody

  if (body.payCadence !== undefined) {
    if (typeof body.payCadence !== "string") {
      return NextResponse.json({ error: "Invalid pay cadence" }, { status: 400 })
    }
    if (!ALLOWED_PAY_CADENCES.has(body.payCadence)) {
      return NextResponse.json({ error: "Unsupported pay cadence" }, { status: 400 })
    }
    try {
      assertPayCadencePersistable(body.payCadence)
    } catch {
      return NextResponse.json(
        { error: "Daily pay cadence is not available in this environment." },
        { status: 400 },
      )
    }
  }

  if (body.payDays !== undefined) {
    const parsed = parsePayDays(body.payDays)
    if (parsed === null) {
      return NextResponse.json(
        { error: "payDays must be an array of integers from 1 to 31, or 32 for the last day of the month" },
        { status: 400 },
      )
    }
  }

  if (body.payDayOfWeek !== undefined && body.payDayOfWeek !== null) {
    if (
      typeof body.payDayOfWeek !== "number" ||
      !Number.isInteger(body.payDayOfWeek) ||
      body.payDayOfWeek < 0 ||
      body.payDayOfWeek > 6
    ) {
      return NextResponse.json({ error: "payDayOfWeek must be an integer from 0 to 6" }, { status: 400 })
    }
  }

  if (body.lastPaydayAt !== undefined) {
    const parsed = parseOptionalIsoDate(body.lastPaydayAt)
    if (parsed === "invalid") {
      return NextResponse.json({ error: "lastPaydayAt must be a valid ISO date or null" }, { status: 400 })
    }
  }

  if (body.estimatedAnnualIncome !== undefined && body.estimatedAnnualIncome !== null) {
    if (typeof body.estimatedAnnualIncome !== "number" || !Number.isFinite(body.estimatedAnnualIncome)) {
      return NextResponse.json({ error: "estimatedAnnualIncome must be a finite number or null" }, { status: 400 })
    }
    const validated = validateDecimal12_2(body.estimatedAnnualIncome, "estimatedAnnualIncome")
    if (!validated.ok) {
      return NextResponse.json({ error: validated.error }, { status: 400 })
    }
  }

  if (body.sweepDefaultPolicy !== undefined) {
    if (typeof body.sweepDefaultPolicy !== "string" || !ALLOWED_SWEEP_POLICIES.has(body.sweepDefaultPolicy)) {
      return NextResponse.json({ error: "Invalid sweepDefaultPolicy" }, { status: 400 })
    }
  }

  if (body.sweepDefaultCapMultiplier !== undefined && body.sweepDefaultCapMultiplier !== null) {
    if (
      typeof body.sweepDefaultCapMultiplier !== "number" ||
      !Number.isFinite(body.sweepDefaultCapMultiplier)
    ) {
      return NextResponse.json(
        { error: "sweepDefaultCapMultiplier must be a positive number or null" },
        { status: 400 },
      )
    }
    const validated = validateDecimal4_2Positive(
      body.sweepDefaultCapMultiplier,
      "sweepDefaultCapMultiplier",
    )
    if (!validated.ok) {
      return NextResponse.json({ error: validated.error }, { status: 400 })
    }
  }

  if (body.savingsExperience !== undefined) {
    if (
      typeof body.savingsExperience !== "string" ||
      !ALLOWED_SAVINGS_EXPERIENCES.has(body.savingsExperience)
    ) {
      return NextResponse.json({ error: "Invalid savingsExperience" }, { status: 400 })
    }
  }

  // Never allow encryptedPrivacyKey / privacyKeySalt via this route — use POST /api/user/encryption
  // (guarded) so existing keys cannot be clobbered by mistake or a buggy client.
  const data: Record<string, unknown> = {}
  for (const field of ALLOWED_SETTINGS_PUT_FIELDS) {
    if (body[field] === undefined) continue
    if (field === "payDays") {
      data.payDays = parsePayDays(body.payDays)
      continue
    }
    if (field === "lastPaydayAt") {
      const parsed = parseOptionalIsoDate(body.lastPaydayAt)
      data.lastPaydayAt = parsed === "invalid" ? undefined : parsed
      continue
    }
    if (field === "estimatedAnnualIncome") {
      const income = body.estimatedAnnualIncome
      if (income === null || income === undefined) {
        data.estimatedAnnualIncome = null
      } else {
        const validated = validateDecimal12_2(income, "estimatedAnnualIncome")
        data.estimatedAnnualIncome = new Prisma.Decimal(validated.ok ? validated.value : 0)
      }
      continue
    }
    if (field === "sweepDefaultCapMultiplier") {
      const mult = body.sweepDefaultCapMultiplier
      if (mult === null || mult === undefined) {
        data.sweepDefaultCapMultiplier = null
      } else {
        const validated = validateDecimal4_2Positive(mult, "sweepDefaultCapMultiplier")
        data.sweepDefaultCapMultiplier = new Prisma.Decimal(validated.ok ? validated.value : 1)
      }
      continue
    }
    data[field] = body[field]
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json(
      { error: "No valid settings fields to update" },
      { status: 400 },
    )
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data,
    select: {
      monthlyIncome: true,
      payCadence: true,
      payDays: true,
      payDayOfWeek: true,
      lastPaydayAt: true,
      estimatedAnnualIncome: true,
      sweepDefaultPolicy: true,
      sweepDefaultCapMultiplier: true,
      savingsExperience: true,
      onboardingComplete: true,
      btcDisplayUnit: true,
      opportunityCostEnabled: true,
      receiptInboxToken: true,
      name: true,
    },
  })

  return NextResponse.json({
    ...updated,
    lastPaydayAt: updated.lastPaydayAt?.toISOString() ?? null,
    estimatedAnnualIncome: serializeDecimal(updated.estimatedAnnualIncome),
    sweepDefaultCapMultiplier: serializeDecimal(updated.sweepDefaultCapMultiplier),
  })
}
