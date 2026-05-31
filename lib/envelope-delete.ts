import { ENVELOPE_DELETE_GRACE_DAYS } from "@/lib/constants"

const MS_PER_DAY = 86_400_000

export function envelopeDeletePurgeCutoff(now: Date = new Date()): Date {
  return new Date(now.getTime() - ENVELOPE_DELETE_GRACE_DAYS * MS_PER_DAY)
}

export function isEnvelopeSoftDeleted(envelope: { deletedAt?: string | null }): boolean {
  return envelope.deletedAt != null && envelope.deletedAt !== ""
}

export function canRestoreSoftDeletedEnvelope(
  envelope: { deletedAt?: string | null },
  nowMs: number = Date.now(),
): boolean {
  if (!isEnvelopeSoftDeleted(envelope)) return false
  const deletedMs = Date.parse(envelope.deletedAt!)
  if (!Number.isFinite(deletedMs)) return false
  return nowMs - deletedMs < ENVELOPE_DELETE_GRACE_DAYS * MS_PER_DAY
}

export function daysUntilEnvelopePurge(
  envelope: { deletedAt?: string | null },
  nowMs: number = Date.now(),
): number | null {
  if (!isEnvelopeSoftDeleted(envelope)) return null
  const deletedMs = Date.parse(envelope.deletedAt!)
  if (!Number.isFinite(deletedMs)) return null
  const purgeMs = deletedMs + ENVELOPE_DELETE_GRACE_DAYS * MS_PER_DAY
  return Math.max(0, Math.ceil((purgeMs - nowMs) / MS_PER_DAY))
}
