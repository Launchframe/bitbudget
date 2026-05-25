import { isReservedSavingsEnvelopeName, SYSTEM_ENVELOPE_ROLE_SAVINGS } from "@/lib/constants"

export type SyncEnvelopeDraft = {
  id?: string
  name: string
}

export type ServerEnvelopeRow = {
  id: string
  name: string
  systemRole: string | null
}

/**
 * Attach server ids to id-less "Savings" drafts so sync never creates a discretionary Savings row.
 */
export function resolveSavingsDraftIds(
  drafts: SyncEnvelopeDraft[],
  server: readonly ServerEnvelopeRow[],
): void {
  const systemSav = server.find((e) => e.systemRole === SYSTEM_ENVELOPE_ROLE_SAVINGS)
  for (const draft of drafts) {
    if (!isReservedSavingsEnvelopeName(draft.name) || draft.id) continue
    if (systemSav) {
      draft.id = systemSav.id
      continue
    }
    const legacyNamed = server.find((e) => isReservedSavingsEnvelopeName(e.name))
    if (legacyNamed) draft.id = legacyNamed.id
  }
}

export function hasUnresolvedSavingsDraft(drafts: readonly SyncEnvelopeDraft[]): boolean {
  return drafts.some((d) => isReservedSavingsEnvelopeName(d.name) && !d.id)
}
