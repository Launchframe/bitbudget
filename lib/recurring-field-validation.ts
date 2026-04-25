/** Shared guards for recurring transaction API bodies (align with `app/api/transactions` POST). */

export const RECURRING_TXN_TYPES = new Set(["expense", "credit"])

export function isPositiveFiniteAmount(raw: unknown): boolean {
  const n = typeof raw === "number" ? raw : Number(raw)
  return Number.isFinite(n) && n > 0
}

export function assertTagStringArray(tags: unknown): tags is string[] {
  return Array.isArray(tags) && tags.every((x) => typeof x === "string")
}

export function parseCalendarDateString(dateStr: unknown): Date | null {
  if (typeof dateStr !== "string") return null
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr)
  if (!match) return null

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const d = new Date(Date.UTC(year, month - 1, day))

  return d.getUTCFullYear() === year &&
    d.getUTCMonth() === month - 1 &&
    d.getUTCDate() === day
    ? d
    : null
}
