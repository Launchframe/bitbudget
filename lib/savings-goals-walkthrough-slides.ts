import { SAVINGS_GOAL_GRACE_DAYS } from "@/lib/savings-goal"

export type SavingsGoalsWalkthroughSlideId =
  | "idea"
  | "month-starts"
  | "first-week"
  | "after-that"
  | "month-ends"
  | "ready"

export interface SavingsGoalsWalkthroughSlide {
  id: SavingsGoalsWalkthroughSlideId
  title: string
  body: string
}

export function buildSavingsGoalsWalkthroughSlides(): SavingsGoalsWalkthroughSlide[] {
  const days = SAVINGS_GOAL_GRACE_DAYS
  return [
    {
      id: "idea",
      title: "Pay yourself first",
      body: "Your income lands in Savings first. Each month we track how much your balance grows toward a target you choose.",
    },
    {
      id: "month-starts",
      title: "A new month begins",
      body: "Your default goal applies automatically. Change it anytime on the Savings card on your dashboard or here in Settings.",
    },
    {
      id: "first-week",
      title: "Your first week",
      body: `For the first ${days} days of the month—or the first ${days} days after you joined, if you signed up mid-month—you can set or lower this month's target.`,
    },
    {
      id: "after-that",
      title: "After that",
      body: "You can only raise the goal for the rest of the month. Watch your progress on the ring around the Savings card.",
    },
    {
      id: "month-ends",
      title: "When the month ends",
      body: "We compare your savings to your target. Hit it and your streak grows. Miss it and the streak resets. Beat your target and the extra stays in Savings.",
    },
    {
      id: "ready",
      title: "Are you ready to start saving?",
      body: "Small steps add up. You've got this.",
    },
  ]
}
