import { randomBytes } from "crypto"
import { prisma } from "@/lib/db"
import { resolveEffectiveTier } from "@/lib/subscription"

export const REFERRAL_USER_CODE_LENGTH = 8
export const USER_REFERRAL_CODE_TTL_DAYS = 7

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

export type ReferralCodeType = "user" | "offer"

export function generateUserReferralCodeSegment(): string {
  let out = ""
  const buf = randomBytes(REFERRAL_USER_CODE_LENGTH)
  for (let i = 0; i < REFERRAL_USER_CODE_LENGTH; i++) {
    out += CODE_CHARS[buf[i]! % CODE_CHARS.length]!
  }
  return out
}

export function normalizeReferralCodeInput(raw: string): string {
  return raw.trim().toUpperCase()
}

/** URL-safe slug for offer codes (lowercase in DB for consistency). */
export function normalizeOfferSlug(raw: string): string {
  return raw.trim().toLowerCase()
}

export function isValidOfferSlug(slug: string): boolean {
  if (slug.length < 2 || slug.length > 64) return false
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)
}

export function addMonthsUtc(d: Date, months: number): Date {
  const x = new Date(d.getTime())
  const day = x.getUTCDate()
  x.setUTCMonth(x.getUTCMonth() + months)
  if (x.getUTCDate() < day) {
    x.setUTCDate(0)
  }
  return x
}

export type ValidateReferralCodeResult =
  | {
      valid: true
      type: ReferralCodeType
      codeRow: { id: string; code: string; label: string | null; ownerId: string }
      referrerName: string | null
    }
  | { valid: false; reason: string }

export async function validateReferralCodeRow(
  rawCode: string,
  now: Date = new Date(),
): Promise<ValidateReferralCodeResult> {
  const trimmed = rawCode.trim()
  if (!trimmed) return { valid: false, reason: "empty" }

  const userNorm = normalizeReferralCodeInput(trimmed)
  const offerNorm = normalizeOfferSlug(trimmed)

  const row = await prisma.referralCode.findFirst({
    where: {
      OR: [{ code: userNorm }, { code: offerNorm }],
      active: true,
    },
    include: {
      owner: { select: { name: true, email: true } },
    },
  })

  if (!row) return { valid: false, reason: "not_found" }
  if (row.startsAt > now) return { valid: false, reason: "not_started" }
  if (row.expiresAt <= now) return { valid: false, reason: "expired" }
  if (row.usedCount >= row.maxUses) return { valid: false, reason: "exhausted" }

  const referrerName = row.owner.name ?? row.owner.email ?? null

  return {
    valid: true,
    type: row.type as ReferralCodeType,
    codeRow: {
      id: row.id,
      code: row.code,
      label: row.label,
      ownerId: row.ownerId,
    },
    referrerName,
  }
}

export async function incrementReferralVisit(codeId: string): Promise<void> {
  try {
    await prisma.referralCode.update({
      where: { id: codeId },
      data: { visitCount: { increment: 1 } },
    })
  } catch {
    // fire-and-forget
  }
}

export async function getActiveUnusedUserCode(ownerId: string, now: Date = new Date()) {
  return prisma.referralCode.findFirst({
    where: {
      ownerId,
      type: "user",
      active: true,
      expiresAt: { gt: now },
      usedCount: 0,
    },
    orderBy: { createdAt: "desc" },
  })
}

async function createUniqueUserReferralCode(ownerId: string, now: Date): Promise<{ id: string; code: string; expiresAt: Date }> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const code = generateUserReferralCodeSegment()
    const exists = await prisma.referralCode.findUnique({ where: { code } })
    if (exists) continue
    const expiresAt = new Date(now.getTime() + USER_REFERRAL_CODE_TTL_DAYS * 86400000)
    const row = await prisma.referralCode.create({
      data: {
        code,
        type: "user",
        ownerId,
        maxUses: 1,
        usedCount: 0,
        expiresAt,
        startsAt: now,
        active: true,
      },
      select: { id: true, code: true, expiresAt: true },
    })
    return row
  }
  throw new Error("Could not allocate referral code")
}

export async function ensureUserReferralCode(
  ownerId: string,
  now: Date = new Date(),
): Promise<{ id: string; code: string; expiresAt: Date }> {
  const existing = await getActiveUnusedUserCode(ownerId, now)
  if (existing) {
    return { id: existing.id, code: existing.code, expiresAt: existing.expiresAt }
  }
  return createUniqueUserReferralCode(ownerId, now)
}

export async function redeemReferralCode(args: {
  refereeId: string
  rawCode: string
  shareMethod?: string | null
  now?: Date
}): Promise<
  | { ok: true; codeType: ReferralCodeType; referrerId: string }
  | { ok: false; status: number; code: string; message: string }
> {
  const now = args.now ?? new Date()
  const validation = await validateReferralCodeRow(args.rawCode, now)
  if (!validation.valid) {
    const gone = validation.reason === "expired" || validation.reason === "exhausted"
    return {
      ok: false,
      status: gone ? 410 : 400,
      code: validation.reason,
      message: "Referral code is not valid",
    }
  }

  const existingRef = await prisma.referral.findUnique({
    where: { refereeId: args.refereeId },
  })
  if (existingRef) {
    return {
      ok: false,
      status: 409,
      code: "already_redeemed",
      message: "This account already used a referral",
    }
  }

  const trialEnd = addMonthsUtc(now, 3)

  try {
    await prisma.$transaction(async (tx) => {
      const locked = await tx.referralCode.findFirst({
        where: { id: validation.codeRow.id },
      })
      if (!locked || !locked.active || locked.startsAt > now || locked.expiresAt <= now) {
        throw Object.assign(new Error("gone"), { status: 410 })
      }
      if (locked.usedCount >= locked.maxUses) {
        throw Object.assign(new Error("gone"), { status: 410 })
      }

      await tx.referral.create({
        data: {
          codeId: locked.id,
          referrerId: locked.ownerId,
          refereeId: args.refereeId,
          status: "accepted",
          shareMethod: args.shareMethod ?? "direct",
        },
      })

      await tx.referralCode.update({
        where: { id: locked.id },
        data: { usedCount: { increment: 1 } },
      })

      await tx.user.update({
        where: { id: args.refereeId },
        data: {
          premiumTrialUntil: trialEnd,
          referredByCodeId: locked.id,
        },
      })
    })
  } catch (e) {
    const err = e as { status?: number; message?: string }
    if (err.status === 410) {
      return { ok: false, status: 410, code: "expired", message: "Referral code expired or exhausted" }
    }
    throw e
  }

  return {
    ok: true,
    codeType: validation.type,
    referrerId: validation.codeRow.ownerId,
  }
}

/**
 * Call after a referred user's first successful Plaid sync. Idempotent per referral row.
 */
export async function activateReferral(refereeUserId: string, now: Date = new Date()): Promise<void> {
  const referral = await prisma.referral.findUnique({
    where: { refereeId: refereeUserId },
    include: { code: true },
  })
  if (!referral || referral.status !== "accepted") return

  const code = referral.code
  if (code.type === "offer") {
    await prisma.referral.update({
      where: { id: referral.id },
      data: { status: "activated", activatedAt: now },
    })
    return
  }

  if (code.type !== "user") return

  const priorActivated = await prisma.referral.count({
    where: { referrerId: referral.referrerId, status: "activated" },
  })
  const rewardMonths = priorActivated === 0 ? 3 : 1

  const referrer = await prisma.user.findUnique({
    where: { id: referral.referrerId },
    select: {
      subscriptionTier: true,
      premiumGratisUntil: true,
    },
  })
  if (!referrer) return

  const base =
    referrer.premiumGratisUntil && referrer.premiumGratisUntil > now
      ? referrer.premiumGratisUntil
      : now
  let newUntil = addMonthsUtc(base, rewardMonths)
  if (referrer.subscriptionTier !== "premium") {
    const cap = addMonthsUtc(now, 3)
    if (newUntil > cap) newUntil = cap
  }

  await prisma.$transaction([
    prisma.referral.update({
      where: { id: referral.id },
      data: { status: "activated", activatedAt: now },
    }),
    prisma.user.update({
      where: { id: referral.referrerId },
      data: { premiumGratisUntil: newUntil },
    }),
  ])

  const { notifyReferralActivated } = await import("@/lib/notify")
  await notifyReferralActivated({
    referrerId: referral.referrerId,
    refereeUserId,
    rewardMonths,
    newGratisUntil: newUntil,
  })
}

export async function referralStatsForUser(userId: string, now: Date = new Date()) {
  const [referralCount, activatedCount, activeCode, userRow] = await Promise.all([
    prisma.referral.count({ where: { referrerId: userId } }),
    prisma.referral.count({ where: { referrerId: userId, status: "activated" } }),
    getActiveUnusedUserCode(userId, now),
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        premiumGratisUntil: true,
        premiumTrialUntil: true,
        subscriptionTier: true,
      },
    }),
  ])

  const lastCode = await prisma.referralCode.findFirst({
    where: { ownerId: userId, type: "user" },
    orderBy: { createdAt: "desc" },
  })

  const effective = userRow
    ? resolveEffectiveTier({
        subscriptionTier: userRow.subscriptionTier,
        premiumGratisUntil: userRow.premiumGratisUntil,
        premiumTrialUntil: userRow.premiumTrialUntil,
      })
    : "free"

  return {
    referralCount,
    activatedCount,
    activeCode,
    lastCode,
    premiumGratisUntil: userRow?.premiumGratisUntil ?? null,
    premiumTrialUntil: userRow?.premiumTrialUntil ?? null,
    effectiveTier: effective,
  }
}
