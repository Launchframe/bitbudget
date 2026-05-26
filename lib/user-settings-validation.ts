/** Boolean fields accepted on PUT /api/user/settings. */
export const USER_SETTINGS_BOOLEAN_FIELDS = [
  "onboardingComplete",
  "walkthroughCompleted",
  "opportunityCostEnabled",
  "setupGuideDismissed",
  "setupGuideShowOnDashboard",
] as const

/** ISO date string or null for setup guide snooze. */
export function setupGuideSnoozedUntilError(value: unknown): string | null {
  if (value === undefined) return null
  if (value === null) return null
  if (typeof value !== "string") {
    return "setupGuideSnoozedUntil must be an ISO 8601 UTC date-time string or null"
  }
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return "setupGuideSnoozedUntil must be a valid ISO 8601 UTC date-time string"
  }
  if (parsed.toISOString() !== value) {
    return "setupGuideSnoozedUntil must be an ISO 8601 UTC date-time string (e.g. 2026-05-25T12:00:00.000Z)"
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
