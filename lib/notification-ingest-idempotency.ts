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
  await prisma.notificationIngestDedupe.delete({
    where: { userId_idempotencyKey: { userId, idempotencyKey } },
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
      if (await notificationIngestAlreadySeen(userId, idempotencyKey)) {
        return "duplicate"
      }
      await prisma.notificationIngestDedupe.create({
        data: { userId, idempotencyKey },
      })
      return "claimed"
    }
    throw err
  }
}

export async function releaseNotificationIngestIdempotency(
  userId: string,
  idempotencyKey: string,
): Promise<void> {
  await prisma.notificationIngestDedupe
    .delete({
      where: { userId_idempotencyKey: { userId, idempotencyKey } },
    })
    .catch(() => undefined)
}
