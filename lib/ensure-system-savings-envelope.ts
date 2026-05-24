import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db"
import { RESERVED_SAVINGS_ENVELOPE_NAME, SYSTEM_ENVELOPE_ROLE_SAVINGS } from "@/lib/constants"

type SavingsEnvelopeDb = Pick<typeof prisma, "envelope">

/** Lookup system Savings envelope for a user (shared with envelope-funding server paths). */
export async function savingsEnvelopeForUserDb(
  db: SavingsEnvelopeDb,
  userId: string,
): Promise<{ id: string } | null> {
  const row = await db.envelope.findFirst({
    where: { userId, systemRole: SYSTEM_ENVELOPE_ROLE_SAVINGS, archived: false },
    select: { id: true },
  })
  return row
}

async function promoteEnvelopeToSystemSavings(
  db: SavingsEnvelopeDb,
  envelopeId: string,
): Promise<{ id: string }> {
  return db.envelope.update({
    where: { id: envelopeId },
    data: {
      archived: false,
      name: RESERVED_SAVINGS_ENVELOPE_NAME,
      monthlyAllotment: 0,
      systemRole: SYSTEM_ENVELOPE_ROLE_SAVINGS,
    },
    select: { id: true },
  })
}

/**
 * Ensure system Savings envelope exists (idempotent). Un-archives a legacy Savings-named row if needed.
 * Pass `tx` to participate in a caller transaction (e.g. settings enable + user row update).
 */
export async function ensureSystemSavingsEnvelope(
  userId: string,
  tx?: Prisma.TransactionClient,
): Promise<{ id: string }> {
  const db = tx ?? prisma

  const existing = await savingsEnvelopeForUserDb(db, userId)
  if (existing) return existing

  // Prefer exact-case canonical name — Postgres unique(userId, name) is case-sensitive, so users
  // can have both "Savings" and "savings"; promoting a non-canonical row would P2002 on rename.
  const canonicalNamed = await db.envelope.findFirst({
    where: { userId, name: RESERVED_SAVINGS_ENVELOPE_NAME },
    select: { id: true },
  })
  if (canonicalNamed) {
    return promoteEnvelopeToSystemSavings(db, canonicalNamed.id)
  }

  const legacyNamed = await db.envelope.findFirst({
    where: {
      userId,
      name: { equals: RESERVED_SAVINGS_ENVELOPE_NAME, mode: "insensitive" },
    },
    select: { id: true },
  })
  if (legacyNamed) {
    try {
      return await promoteEnvelopeToSystemSavings(db, legacyNamed.id)
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        const promoted = await savingsEnvelopeForUserDb(db, userId)
        if (promoted) return promoted
        const fallback = await db.envelope.findFirst({
          where: { userId, name: RESERVED_SAVINGS_ENVELOPE_NAME },
          select: { id: true },
        })
        if (fallback) return promoteEnvelopeToSystemSavings(db, fallback.id)
      }
      throw e
    }
  }

  try {
    return await db.envelope.create({
      data: {
        userId,
        name: RESERVED_SAVINGS_ENVELOPE_NAME,
        monthlyAllotment: 0,
        systemRole: SYSTEM_ENVELOPE_ROLE_SAVINGS,
        color: "#22C55E",
      },
      select: { id: true },
    })
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const promoted = await savingsEnvelopeForUserDb(db, userId)
      if (promoted) return promoted
      const canonical = await db.envelope.findFirst({
        where: { userId, name: RESERVED_SAVINGS_ENVELOPE_NAME },
        select: { id: true },
      })
      if (canonical) return promoteEnvelopeToSystemSavings(db, canonical.id)
      const again = await db.envelope.findFirst({
        where: {
          userId,
          name: { equals: RESERVED_SAVINGS_ENVELOPE_NAME, mode: "insensitive" },
        },
        select: { id: true },
      })
      if (again) {
        try {
          return await promoteEnvelopeToSystemSavings(db, again.id)
        } catch (retryErr) {
          if (
            retryErr instanceof Prisma.PrismaClientKnownRequestError &&
            retryErr.code === "P2002"
          ) {
            const resolved = await savingsEnvelopeForUserDb(db, userId)
            if (resolved) return resolved
            const retryCanonical = await db.envelope.findFirst({
              where: { userId, name: RESERVED_SAVINGS_ENVELOPE_NAME },
              select: { id: true },
            })
            if (retryCanonical) return promoteEnvelopeToSystemSavings(db, retryCanonical.id)
          }
          throw retryErr
        }
      }
    }
    throw e
  }
}
