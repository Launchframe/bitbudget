/** Boolean fields accepted on PUT /api/user/settings. */
export const USER_SETTINGS_BOOLEAN_FIELDS = [
  "onboardingComplete",
  "walkthroughCompleted",
  "opportunityCostEnabled",
  "setupGuideDismissed",
  "setupGuideShowOnDashboard",
] as const

/** ISO date-time string or null for setup guide snooze (normalized to Date on write). */
export function setupGuideSnoozedUntilError(value: unknown): string | null {
  if (value === undefined) return null
  if (value === null) return null
  if (typeof value !== "string") {
    return "setupGuideSnoozedUntil must be an ISO 8601 date-time string or null"
  }
  if (!/^\d{4}-\d{2}-\d{2}T/.test(value)) {
    return "setupGuideSnoozedUntil must be an ISO 8601 date-time string (e.g. 2026-05-25T12:00:00Z)"
  }
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return "setupGuideSnoozedUntil must be a valid ISO 8601 date-time string"
  }
  return null
}

/**
 * Validate the `monthlyIncome` value from a PUT /api/user/settings body.
 * Returns an error string when invalid, null when the value is acceptable.
 */
export function monthlyIncomeError(value: unknown): string | null {
  if (value === undefined) return null
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return "monthlyIncome must be a non-negative finite number"
  }
  return null
}

export type UserSettingsBooleanField = (typeof USER_SETTINGS_BOOLEAN_FIELDS)[number]

/** Returns an error message when a provided boolean field has the wrong type. */
export function booleanSettingsFieldError(
  body: Partial<Record<UserSettingsBooleanField, unknown>>,
): string | null {
  for (const field of USER_SETTINGS_BOOLEAN_FIELDS) {
    if (body[field] !== undefined && typeof body[field] !== "boolean") {
      return `${field} must be a boolean`
    }
  }
  return null
}
