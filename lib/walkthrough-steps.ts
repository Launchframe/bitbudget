import type { PageId } from "@/lib/app-context"

export type WalkthroughTooltipPosition = "right" | "bottom"

export type WalkthroughSettingsTab = "general" | "integrations"

export interface WalkthroughStepDef {
  id: string
  page: PageId
  target: string
  title: string
  description: string
  position: WalkthroughTooltipPosition
  settingsTab?: WalkthroughSettingsTab
  /** Skip step when predicate returns false */
  when?: (ctx: WalkthroughContext) => boolean
}

export interface WalkthroughContext {
  opportunityCostEnabled: boolean
  savingsEngaged: boolean
  hasPremiumFeatures: boolean
  pendingCount: number
}

export function buildWalkthroughSteps(ctx: WalkthroughContext): WalkthroughStepDef[] {
  const steps: WalkthroughStepDef[] = [
    {
      id: "dashboard-metrics",
      page: "dashboard",
      target: "dashboard-metrics",
      title: "Your month at a glance",
      description:
        "Income, what’s left in your envelopes, and Savings show up here as you add activity.",
      position: "bottom",
    },
    {
      id: "dashboard-chart",
      page: "dashboard",
      target: "dashboard-chart",
      title: "Track your cash flow",
      description: ctx.opportunityCostEnabled
        ? "See how your money moves across income and expenses — including your bitcoin opportunity cost, in case you ever wondered, 'how much would that be worth now?'"
        : "See how your money moves across income and expenses.",
      position: "bottom",
    },
    {
      id: "app-nav",
      page: "dashboard",
      target: "app-nav",
      title: "Move around the app",
      description:
        "Home, transactions, budget, and stats are in the nav. On your phone, use the bar at the bottom.",
      position: "bottom",
    },
    {
      id: "setup-progress",
      page: "dashboard",
      target: "setup-progress",
      title: "Finish the essentials",
      description:
        "The setup checklist on Home tracks key steps. You can hide it anytime and find it again in Settings.",
      position: "bottom",
    },
    {
      id: "transactions-header",
      page: "transactions",
      target: "transactions-header",
      title: "Your transaction list",
      description: "Every purchase and deposit lands here, newest first.",
      position: "right",
    },
    {
      id: "new-transaction",
      page: "transactions",
      target: "new-transaction",
      title: "Add a transaction",
      description:
        "Tap the orange + on the bottom bar on your phone, or New Transaction in the sidebar on desktop.",
      position: "bottom",
    },
    {
      id: "scan-receipt",
      page: "transactions",
      target: "scan-receipt",
      title: "Scan a receipt",
      description: "Use a photo or PDF — we suggest fields and you confirm before saving.",
      position: "right",
    },
    {
      id: "savings-hero",
      page: "envelopes",
      target: "savings-hero",
      title: "Savings first",
      description: ctx.savingsEngaged
        ? "Here to help you save for that vacation or that rainy day. Your paychecks land in Savings first, so they can fund spending envelopes from there."
        : "Your paychecks land in Savings first, so they can fund spending envelopes from there.",
      position: "bottom",
    },
    {
      id: "envelope-grid",
      page: "envelopes",
      target: "envelope-grid",
      title: "Your envelopes",
      description: "Plan your spend ahead of time, and see how you're tracking throughout the month. Envelopes refill from Savings at the start of each month.",
      position: "bottom",
    },
    {
      id: "allocations-entry",
      page: "envelopes",
      target: "allocations-entry",
      title: "Divide your paycheck",
      description: "You can always adjust how much of each paycheck goes into each envelope.",
      position: "bottom",
    },
    {
      id: "sweep-cta",
      page: "envelopes",
      target: "sweep-cta",
      title: ctx.savingsEngaged ? "Sweep to Savings" : "Return extra to Savings",
      description: ctx.savingsEngaged
        ? "Supercharge your savings by moving extra cash from envelopes back to Savings."
        : "Sweep extra cash back to Savings anytime you want.",
      position: "bottom",
    },
    {
      id: "review-header",
      page: "review-inbox",
      target: "review-header",
      title: "Pending transactions",
      description:
        ctx.pendingCount > 0
          ? "You have transactions waiting to be reviewed. — approve them before they hit your budget."
          : "Transactions from connected bank accounts and automatic receipt scans will land here for your review.",
      position: "right",
    },
    {
      id: "settings-connections",
      page: "settings",
      target: "settings-connections",
      settingsTab: "integrations",
      title: "Optional connections",
      description: ctx.hasPremiumFeatures
        ? "Link a bank account, connect your email set up email forwarding to let BitBudget automatically record transactions. Sensitive details are encrypted the moment they arrive, so nobody but you can read them."
        : "Premium features like connected bank accounts and receipt scanning makes budgeting a breeze. Reach out to us for a free trial.",
      position: "bottom",
    },
    {
      id: "settings-setup-guide",
      page: "settings",
      target: "settings-setup-guide",
      settingsTab: "general",
      title: "Setup guide",
      description: "Track your progress and view your achievements on the road to becoming a budgeting pro.",
      position: "bottom",
    },
  ]

  if (ctx.opportunityCostEnabled) {
    steps.splice(3, 0, {
      id: "analytics-header",
      page: "analytics",
      target: "analytics-header",
      title: "Spending stats",
      description: "Analytics breaks down where your money went and how it compares over time.",
      position: "right",
    })
  }

  return steps.filter((s) => (s.when ? s.when(ctx) : true))
}
