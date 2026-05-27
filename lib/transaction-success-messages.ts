import type { TransactionType } from "@/lib/data"

const EXPENSE_SUCCESS_MESSAGES = [
  "Every expense you log is a step toward clarity.",
  "You can't improve what you don't measure — nice work.",
  "Small habits add up. This one counts.",
  "Budgeting is a skill. You're practicing it.",
  "Named it, claimed it. That's how awareness starts.",
  "One more piece of the puzzle — your budget thanks you.",
  "Staying on top of spending is a gift to your future self.",
  "Progress, not perfection. Keep going.",
  "Clarity beats guesswork. You just chose clarity.",
  "You're building a picture of where your money goes.",
] as const

const CREDIT_SUCCESS_MESSAGES = [
  "Income logged — your budget just got sharper.",
  "Every dollar counted is a dollar you can direct.",
  "Nice work keeping your books up to date.",
  "You're making your money visible — that's power.",
  "Another credit on the books. Well done.",
  "Tracking what comes in helps you plan what goes out.",
  "Your budget is stronger when nothing is a surprise.",
  "Logged and locked in. Onward.",
] as const

const RECURRING_SUCCESS_MESSAGES = [
  "Set it and forget it — we'll remind you when it's due.",
  "Future you will thank you for setting this up.",
  "Recurring expense handled. One less thing to remember.",
  "Automation for the win. Your budget stays current.",
] as const

export function pickTransactionSuccessMessage(
  type: TransactionType,
  options?: { isRecurring?: boolean },
): string {
  const pool = options?.isRecurring
    ? RECURRING_SUCCESS_MESSAGES
    : type === "credit"
      ? CREDIT_SUCCESS_MESSAGES
      : EXPENSE_SUCCESS_MESSAGES
  return pool[Math.floor(Math.random() * pool.length)] ?? pool[0]
}
