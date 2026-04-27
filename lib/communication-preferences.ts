export type CommunicationPreferenceKey =
  | "featureUpdates"
  | "feedbackRequests"
  | "recurringReminders"
  | "renewalReminders"
  | "importAlerts"

export type CommunicationEmailCategory =
  | "feature_updates"
  | "feedback_requests"
  | "recurring_reminders"
  | "renewal_reminders"
  | "import_alerts"

export type EmailCategory =
  | CommunicationPreferenceKey
  | CommunicationEmailCategory
  | "securityAlerts"
  | "security_alerts"

export interface CommunicationPreferences {
  featureUpdates: boolean
  feedbackRequests: boolean
  recurringReminders: boolean
  renewalReminders: boolean
  importAlerts: boolean
}

export type CommunicationPreferenceColumn =
  | "emailFeatureUpdates"
  | "emailFeedbackRequests"
  | "emailRecurringReminders"
  | "emailRenewalReminders"
  | "emailImportAlerts"

export const COMMUNICATION_PREFERENCE_COLUMNS = {
  featureUpdates: "emailFeatureUpdates",
  feedbackRequests: "emailFeedbackRequests",
  recurringReminders: "emailRecurringReminders",
  renewalReminders: "emailRenewalReminders",
  importAlerts: "emailImportAlerts",
} as const satisfies Record<CommunicationPreferenceKey, CommunicationPreferenceColumn>

export const COMMUNICATION_PREFERENCE_KEYS = Object.keys(
  COMMUNICATION_PREFERENCE_COLUMNS,
) as CommunicationPreferenceKey[]

export const EMAIL_PREFERENCE_KEYS = Object.values(COMMUNICATION_PREFERENCE_COLUMNS)

export const COMMUNICATION_EMAIL_CATEGORY_KEYS = {
  feature_updates: "featureUpdates",
  feedback_requests: "feedbackRequests",
  recurring_reminders: "recurringReminders",
  renewal_reminders: "renewalReminders",
  import_alerts: "importAlerts",
} as const satisfies Record<CommunicationEmailCategory, CommunicationPreferenceKey>

export interface CommunicationPreferenceDescriptor {
  key: CommunicationPreferenceKey
  field: CommunicationPreferenceColumn
  label: string
  description: string
  emailReason: string
}

export const COMMUNICATION_PREFERENCES: CommunicationPreferenceDescriptor[] = [
  {
    key: "featureUpdates",
    field: "emailFeatureUpdates",
    label: "Feature updates",
    description: "Product announcements, tips, and ways to get more out of BitBudget.",
    emailReason: "you opted in to BitBudget feature updates",
  },
  {
    key: "feedbackRequests",
    field: "emailFeedbackRequests",
    label: "Feedback requests",
    description: "Occasional personal outreach from the team to learn about your experience.",
    emailReason: "you opted in to BitBudget feedback requests",
  },
  {
    key: "recurringReminders",
    field: "emailRecurringReminders",
    label: "Recurring transaction reminders",
    description: "Reminders about upcoming recurring transactions you track in your budget.",
    emailReason: "you opted in to recurring transaction reminders",
  },
  {
    key: "renewalReminders",
    field: "emailRenewalReminders",
    label: "Renewal reminders",
    description: "Premium trial, bonus premium, and renewal-related reminders.",
    emailReason: "you opted in to premium renewal reminders",
  },
  {
    key: "importAlerts",
    field: "emailImportAlerts",
    label: "Imported transaction alerts",
    description: "Notices when integrations import new transactions for your review.",
    emailReason: "you opted in to imported transaction alerts",
  },
]

export const COMMUNICATION_PREFERENCE_DETAILS = COMMUNICATION_PREFERENCES

export const DEFAULT_COMMUNICATION_PREFERENCES: CommunicationPreferences = {
  featureUpdates: true,
  feedbackRequests: true,
  recurringReminders: true,
  renewalReminders: true,
  importAlerts: true,
}

export function normalizeCommunicationPreferences(input: Partial<CommunicationPreferences>): CommunicationPreferences {
  return {
    featureUpdates: input.featureUpdates ?? true,
    feedbackRequests: input.feedbackRequests ?? true,
    recurringReminders: input.recurringReminders ?? true,
    renewalReminders: input.renewalReminders ?? true,
    importAlerts: input.importAlerts ?? true,
  }
}

export const normalizeEmailPreferences = normalizeCommunicationPreferences

export function isCommunicationPreferenceKey(value: unknown): value is CommunicationPreferenceKey {
  if (typeof value !== "string") return false
  return Object.prototype.hasOwnProperty.call(COMMUNICATION_PREFERENCE_COLUMNS, value)
}

export function isCommunicationEmailCategory(value: unknown): value is CommunicationEmailCategory {
  if (typeof value !== "string") return false
  return Object.prototype.hasOwnProperty.call(COMMUNICATION_EMAIL_CATEGORY_KEYS, value)
}

export function communicationKeyForCategory(category: CommunicationEmailCategory): CommunicationPreferenceKey {
  return COMMUNICATION_EMAIL_CATEGORY_KEYS[category]
}

export function communicationPreferenceForCategory(
  category: CommunicationEmailCategory,
): CommunicationPreferenceDescriptor {
  const key = communicationKeyForCategory(category)
  return communicationPreferenceForKey(key)
}

export function communicationPreferenceForKey(
  key: CommunicationPreferenceKey,
): CommunicationPreferenceDescriptor {
  const preference = COMMUNICATION_PREFERENCES.find((p) => p.key === key)
  if (!preference) {
    const exhaustive: never = key
    throw new Error(`Unhandled communication preference: ${exhaustive}`)
  }
  return preference
}

export function preferenceColumnForCategory(
  category: EmailCategory,
): CommunicationPreferenceColumn | null {
  if (category === "securityAlerts" || category === "security_alerts") return null
  if (isCommunicationEmailCategory(category)) {
    return COMMUNICATION_PREFERENCE_COLUMNS[communicationKeyForCategory(category)]
  }
  return COMMUNICATION_PREFERENCE_COLUMNS[category]
}

export const preferenceFieldForCategory = preferenceColumnForCategory

export function emailPreferenceUpdateData(
  preferences: Partial<CommunicationPreferences>,
): Partial<Record<CommunicationPreferenceColumn, boolean>> {
  const data: Partial<Record<CommunicationPreferenceColumn, boolean>> = {}
  for (const key of COMMUNICATION_PREFERENCE_KEYS) {
    const value = preferences[key]
    if (typeof value === "boolean") {
      data[COMMUNICATION_PREFERENCE_COLUMNS[key]] = value
    }
  }
  return data
}

export function userAllowsCommunicationEmail(
  user: Partial<Record<CommunicationPreferenceColumn, boolean | null>>,
  category: CommunicationEmailCategory | "security_alerts",
): boolean {
  if (category === "security_alerts") return true
  const field = communicationPreferenceForCategory(category).field
  return user[field] ?? true
}

export function emailPreferencesFromUser(
  user: Partial<Record<CommunicationPreferenceColumn, boolean | null>>,
): CommunicationPreferences {
  return normalizeCommunicationPreferences({
    featureUpdates: user.emailFeatureUpdates ?? true,
    feedbackRequests: user.emailFeedbackRequests ?? true,
    recurringReminders: user.emailRecurringReminders ?? true,
    renewalReminders: user.emailRenewalReminders ?? true,
    importAlerts: user.emailImportAlerts ?? true,
  })
}
