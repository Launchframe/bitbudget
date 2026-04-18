export type SurveyTriggerType = "general" | "referrer" | "referee"

export interface SurveyEligibilityInput {
  onboardingComplete: boolean
  createdAt: Date
  transactionCount: number
  hasReferralReceived: boolean
  survey: {
    completedAt: Date | null
    dismissType: string | null
    currentStep: number
  } | null
  /** True when client set sessionStorage after generating a referral code this session */
  sessionReferrerTrigger: boolean
}

export interface SurveyEligibilityResult {
  eligible: boolean
  triggerType: SurveyTriggerType | null
  resumeStep: number
}

const MS_DAY = 86400000

export function computeSurveyEligibility(input: SurveyEligibilityInput): SurveyEligibilityResult {
  if (!input.onboardingComplete) {
    return { eligible: false, triggerType: null, resumeStep: 1 }
  }

  const s = input.survey
  if (s?.completedAt) {
    return { eligible: false, triggerType: null, resumeStep: 1 }
  }
  if (s?.dismissType === "never") {
    return { eligible: false, triggerType: null, resumeStep: 1 }
  }

  const now = Date.now()
  const ageOk = now - input.createdAt.getTime() >= 7 * MS_DAY
  const hasTxn = input.transactionCount >= 1

  let triggerType: SurveyTriggerType | null = null
  if (input.sessionReferrerTrigger) {
    triggerType = "referrer"
  } else if (ageOk && input.hasReferralReceived) {
    triggerType = "referee"
  } else if (ageOk && hasTxn) {
    triggerType = "general"
  }

  if (!triggerType) {
    return { eligible: false, triggerType: null, resumeStep: s?.currentStep ?? 1 }
  }

  if (input.transactionCount < 1) {
    return { eligible: false, triggerType: null, resumeStep: s?.currentStep ?? 1 }
  }

  return {
    eligible: true,
    triggerType,
    resumeStep: s?.currentStep && s.currentStep >= 1 && s.currentStep <= 6 ? s.currentStep : 1,
  }
}
