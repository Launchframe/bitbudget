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
      title: "Spending over time",
      description: ctx.opportunityCostEnabled
        ? "This chart fills in as you record expenses — including Bitcoin opportunity cost when enabled."
        : "This chart fills in as you record expenses.",
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
        ? "Paychecks land in Savings first. You fund envelopes from there and can set monthly goals."
        : "Paychecks land in Savings first. You fund envelopes from there.",
      position: "bottom",
    },
    {
      id: "envelope-grid",
      page: "envelopes",
      target: "envelope-grid",
      title: "Your envelopes",
      description: "Each category has a monthly amount and a running balance for what’s left to spend.",
      position: "bottom",
    },
    {
      id: "allocations-entry",
      page: "envelopes",
      target: "allocations-entry",
      title: "Divide your paycheck",
      description: "Open allocations to give every envelope a share of your income.",
      position: "bottom",
    },
    {
      id: "sweep-cta",
      page: "envelopes",
      target: "sweep-cta",
      title: ctx.savingsEngaged ? "Sweep leftovers" : "Return extra to Savings",
      description: ctx.savingsEngaged
        ? "Move unspent envelope money back to Savings when you’re ready."
        : "Move unspent envelope money back to Savings anytime.",
      position: "bottom",
    },
    {
      id: "review-header",
      page: "review-inbox",
      target: "review-header",
      title: "Review imports",
      description:
        ctx.pendingCount > 0
          ? "You have items waiting — approve them before they hit your budget."
          : "Bank and inbox imports land here for you to approve first.",
      position: "right",
    },
    {
      id: "settings-connections",
      page: "settings",
      target: "settings-connections",
      settingsTab: "integrations",
      title: "Optional connections",
      description: ctx.hasPremiumFeatures
        ? "Link a bank or receipt inbox if you want — each adds identifying info to your account, so only connect what you’re comfortable with."
        : "Premium unlocks bank sync and a receipt inbox. Each connection adds identifying info — connect only what you’re comfortable with.",
      position: "bottom",
    },
    {
      id: "settings-setup-guide",
      page: "settings",
      target: "settings-setup-guide",
      settingsTab: "general",
      title: "Setup guide in Settings",
      description: "Track progress, snooze, or bring the checklist back to your dashboard whenever you like.",
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
