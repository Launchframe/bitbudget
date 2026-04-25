/** Shared guards for recurring transaction API bodies (align with `app/api/transactions` POST). */

export const RECURRING_TXN_TYPES = new Set(["expense", "credit"])

export function isPositiveFiniteAmount(raw: unknown): raw is number {
  const n = typeof raw === "number" ? raw : Number(raw)
  return Number.isFinite(n) && n > 0
}

export function assertTagStringArray(tags: unknown): tags is string[] {
  return Array.isArray(tags) && tags.every((x) => typeof x === "string")
}

export function parseCalendarDateString(dateStr: unknown): Date | null {
  if (typeof dateStr !== "string") return null
  const d = new Date(dateStr)
  return Number.isNaN(d.getTime()) ? null : d
}
