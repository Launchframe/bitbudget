/** Boolean fields accepted on PUT /api/user/settings. */
export const USER_SETTINGS_BOOLEAN_FIELDS = [
  "onboardingComplete",
  "walkthroughCompleted",
  "opportunityCostEnabled",
] as const

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
