/** Canonical admin audit-log action strings (UI filter + writers). */
export const AUDIT_LOG_ACTIONS = [
  "sender.created",
  "sender.deleted",
  "sender.approved",
  "sender.dismissed",
  "user.tier_updated",
] as const

export type AuditLogAction = (typeof AUDIT_LOG_ACTIONS)[number]

export const AUDIT_LOG_ACTION_LABELS: Record<AuditLogAction, string> = {
  "sender.created": "sender.created",
  "sender.deleted": "sender.deleted",
  "sender.approved": "sender.approved",
  "sender.dismissed": "sender.dismissed",
  "user.tier_updated": "user.tier_updated",
}
