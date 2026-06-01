import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db"

export const NOTIFICATION_INGEST_IDEMPOTENCY_MAX_LEN = 128

const DEDUPE_HOURS = 24

export function normalizeIdempotencyKey(raw: string | null | undefined): string | null {
  const key = raw?.trim()
  if (!key) return null
  if (key.length > NOTIFICATION_INGEST_IDEMPOTENCY_MAX_LEN) {
    return key.slice(0, NOTIFICATION_INGEST_IDEMPOTENCY_MAX_LEN)
  }
  return key
}

function dedupeSince(): Date {
  return new Date(Date.now() - DEDUPE_HOURS * 60 * 60 * 1000)
}

/** Drop idempotency rows older than the dedupe window so the table does not grow forever. */
export async function purgeExpiredNotificationIngestDedupes(userId?: string): Promise<void> {
  const since = dedupeSince()
  await prisma.notificationIngestDedupe.deleteMany({
    where: {
      createdAt: { lt: since },
      ...(userId ? { userId } : {}),
    },
  })
}

/** @returns true when this key was already claimed within the dedupe window */
export async function notificationIngestAlreadySeen(
  userId: string,
  idempotencyKey: string,
): Promise<boolean> {
  const since = dedupeSince()
  const row = await prisma.notificationIngestDedupe.findUnique({
    where: { userId_idempotencyKey: { userId, idempotencyKey } },
    select: { createdAt: true },
  })
  if (!row) return false
  if (row.createdAt >= since) return true
  await prisma.notificationIngestDedupe.deleteMany({
    where: { userId, idempotencyKey, createdAt: { lt: since } },
  })
  return false
}

/**
 * Claim idempotency key before ingest. Deletes the claim if ingest fails so retries work.
 */
export async function claimNotificationIngestIdempotency(
  userId: string,
  idempotencyKey: string,
): Promise<"claimed" | "duplicate"> {
  await purgeExpiredNotificationIngestDedupes(userId)
  try {
    await prisma.notificationIngestDedupe.create({
      data: { userId, idempotencyKey },
    })
    return "claimed"
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      return "duplicate"
    }
    throw err
  }
}

export async function releaseNotificationIngestIdempotency(
  userId: string,
  idempotencyKey: string,
): Promise<void> {
  await prisma.notificationIngestDedupe.deleteMany({
    where: { userId, idempotencyKey },
  })
}
