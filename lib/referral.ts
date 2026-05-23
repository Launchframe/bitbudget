import { randomBytes } from "crypto"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db"
import { notifyReferralActivated } from "@/lib/notify"
import { refereeTrialMonthsForReferrerSubscription, resolveEffectiveTier } from "@/lib/subscription"

export const REFERRAL_USER_CODE_LENGTH = 8
export const USER_REFERRAL_CODE_TTL_DAYS = 7
/** After onboarding, referees may redeem a referral code in Settings for this many days. */
export const REFEREE_POST_ONBOARDING_REDEEM_DAYS = 7

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

export function refereePostOnboardingRedeemDeadline(onboardingCompletedAt: Date | null): Date | null {
  if (!onboardingCompletedAt) return null
  return new Date(onboardingCompletedAt.getTime() + REFEREE_POST_ONBOARDING_REDEEM_DAYS * 86400000)
}

/** Post-onboarding Settings redeem; during onboarding (`onboardingComplete` false) redeem stays allowed. */
export function canRedeemReferralAsPostOnboardingReferee(args: {
  onboardingComplete: boolean
  onboardingCompletedAt: Date | null
  alreadyRedeemed: boolean
  now?: Date
}): boolean {
  if (args.alreadyRedeemed) return false
  if (!args.onboardingComplete) return true
  const deadline = refereePostOnboardingRedeemDeadline(args.onboardingCompletedAt)
  if (!deadline) return false
  return (args.now ?? new Date()) < deadline
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

  const includeOwner = { owner: { select: { name: true } } }
  // Prefer user-normalized key first, then offer slug — avoids arbitrary `findFirst` when both exist.
  let row = await prisma.referralCode.findUnique({ where: { code: userNorm }, include: includeOwner })
  if (!row && userNorm !== offerNorm) {
    row = await prisma.referralCode.findUnique({ where: { code: offerNorm }, include: includeOwner })
  }

  if (!row || !row.active) return { valid: false, reason: "not_found" }
  if (row.startsAt > now) return { valid: false, reason: "not_started" }
  if (row.expiresAt <= now) return { valid: false, reason: "expired" }
  if (row.usedCount >= row.maxUses) return { valid: false, reason: "exhausted" }

  /** Public validate must not leak referrer email — name only (see GET /api/referral/validate). */
  const nameTrimmed = row.owner.name?.trim() ?? ""
  const referrerName = nameTrimmed.length > 0 ? nameTrimmed : null

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
    try {
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
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") continue
      throw e
    }
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

  const refereeUser = await prisma.user.findUnique({
    where: { id: args.refereeId },
    select: { onboardingComplete: true, onboardingCompletedAt: true },
  })
  if (
    refereeUser &&
    !canRedeemReferralAsPostOnboardingReferee({
      onboardingComplete: refereeUser.onboardingComplete,
      onboardingCompletedAt: refereeUser.onboardingCompletedAt,
      alreadyRedeemed: false,
      now,
    })
  ) {
    return {
      ok: false,
      status: 410,
      code: "redeem_window_closed",
      message: "Referral codes can only be applied within 7 days of finishing onboarding",
    }
  }

  if (validation.codeRow.ownerId === args.refereeId) {
    return {
      ok: false,
      status: 400,
      code: "self_referral",
      message: "You cannot redeem your own referral code",
    }
  }

  const codeId = validation.codeRow.id

  try {
    await prisma.$transaction(async (tx) => {
      const bumped = await tx.$executeRaw`
        UPDATE "ReferralCode"
        SET "usedCount" = "usedCount" + 1
        WHERE "id" = ${codeId}
          AND "active" = true
          AND "startsAt" <= ${now}
          AND "expiresAt" > ${now}
          AND "usedCount" < "maxUses"
      `
      // Prisma may return bigint for row counts; `1n !== 1` must not trigger a false 410.
      if (Number(bumped) !== 1) {
        throw Object.assign(new Error("gone"), { status: 410 })
      }

      await tx.referral.create({
        data: {
          codeId,
          referrerId: validation.codeRow.ownerId,
          refereeId: args.refereeId,
          status: "accepted",
          shareMethod: args.shareMethod ?? "direct",
        },
      })

      const referrer = await tx.user.findUnique({
        where: { id: validation.codeRow.ownerId },
        select: { opportunityCostEnabled: true },
      })
      const inheritOpportunityCost = referrer?.opportunityCostEnabled ?? false

      await tx.user.update({
        where: { id: args.refereeId },
        data: {
          referredByCodeId: codeId,
          opportunityCostEnabled: inheritOpportunityCost,
        },
      })
    })
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return {
        ok: false,
        status: 409,
        code: "already_redeemed",
        message: "This account already used a referral",
      }
    }
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

export type ActivateReferralResult = {
  /** True if this call transitioned the referral from accepted → activated. */
  didActivate: boolean
  /** Referee trial length applied (months), if activation happened. */
  refereeTrialMonths: 1 | 3 | null
}

/**
 * Call after a referred user’s first bank link (Plaid item created) or first successful sync.
 * Idempotent: only one activation wins; referee trial is set on first activation only.
 */
export async function activateReferral(
  refereeUserId: string,
  now: Date = new Date(),
): Promise<ActivateReferralResult> {
  type NotifyArg = {
    referrerId: string
    refereeUserId: string
    rewardMonths: number
    newGratisUntil: Date
  }
  let pendingNotify: NotifyArg | null = null
  let result: ActivateReferralResult = { didActivate: false, refereeTrialMonths: null }

  await prisma.$transaction(async (tx) => {
    const referral = await tx.referral.findUnique({
      where: { refereeId: refereeUserId },
      include: { code: true },
    })
    if (!referral || referral.status !== "accepted") return

    const referrer = await tx.user.findUnique({
      where: { id: referral.referrerId },
      select: {
        subscriptionTier: true,
        premiumGratisUntil: true,
      },
    })
    if (!referrer) return

    const trialMonths = refereeTrialMonthsForReferrerSubscription(referrer.subscriptionTier)
    const code = referral.code

    if (code.type === "offer") {
      const activatedOffer = await tx.referral.updateMany({
        where: { id: referral.id, status: "accepted" },
        data: { status: "activated", activatedAt: now },
      })
      if (activatedOffer.count === 0) return
      await tx.user.update({
        where: { id: refereeUserId },
        data: { premiumTrialUntil: addMonthsUtc(now, trialMonths) },
      })
      result = { didActivate: true, refereeTrialMonths: trialMonths }
      return
    }

    if (code.type !== "user") return

    // Lock referrer before flipping referral so concurrent activations get a deterministic first bonus.
    await tx.$queryRaw`SELECT 1 FROM "User" WHERE "id" = ${referral.referrerId} FOR UPDATE`

    const activated = await tx.referral.updateMany({
      where: { id: referral.id, status: "accepted" },
      data: { status: "activated", activatedAt: now },
    })
    if (activated.count === 0) return

    await tx.user.update({
      where: { id: refereeUserId },
      data: { premiumTrialUntil: addMonthsUtc(now, trialMonths) },
    })

    result = { didActivate: true, refereeTrialMonths: trialMonths }

    const totalActivated = await tx.referral.count({
      where: { referrerId: referral.referrerId, status: "activated" },
    })
    const rewardMonths = totalActivated === 1 ? 3 : 1

    const base =
      referrer.premiumGratisUntil && referrer.premiumGratisUntil > now
        ? referrer.premiumGratisUntil
        : now
    let newUntil = addMonthsUtc(base, rewardMonths)
    if (referrer.subscriptionTier !== "premium") {
      const cap = addMonthsUtc(now, 3)
      if (newUntil > cap) newUntil = cap
    }

    await tx.user.update({
      where: { id: referral.referrerId },
      data: { premiumGratisUntil: newUntil },
    })

    pendingNotify = {
      referrerId: referral.referrerId,
      refereeUserId,
      rewardMonths,
      newGratisUntil: newUntil,
    }
  })

  if (pendingNotify) {
    await notifyReferralActivated(pendingNotify)
  }

  return result
}

export async function referralStatsForUser(
  userId: string,
  now: Date = new Date(),
  /** When the caller already loaded premium fields, skip a duplicate `User` read. */
  userPremium?: { premiumGratisUntil: Date | null; premiumTrialUntil: Date | null; subscriptionTier: string },
) {
  const userRowPromise =
    userPremium !== undefined
      ? Promise.resolve(userPremium)
      : prisma.user.findUnique({
          where: { id: userId },
          select: {
            premiumGratisUntil: true,
            premiumTrialUntil: true,
            subscriptionTier: true,
          },
        })

  const [referralCount, activatedCount, activeCode, userRow] = await Promise.all([
    prisma.referral.count({ where: { referrerId: userId } }),
    prisma.referral.count({ where: { referrerId: userId, status: "activated" } }),
    getActiveUnusedUserCode(userId, now),
    userRowPromise,
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
