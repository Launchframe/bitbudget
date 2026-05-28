import type { PageId } from "@/lib/app-context"
import type { TransactionPrefill } from "@/lib/app-context"

export type WalkthroughTooltipPosition = "right" | "bottom"

export type WalkthroughSettingsTab = "general" | "integrations"

export type SpotlightAction = "open-new-transaction" | "open-input-mode-sheet"
export type AwaitCloseTarget = "new-transaction-dialog" | "input-mode-sheet"

export interface WalkthroughSpotlight {
  /** Label shown near the spotlighted element */
  prompt: string
  /** Action the overlay takes when user clicks the spotlighted element */
  action: SpotlightAction
  /** Prefill to pass when action is open-new-transaction */
  prefill?: TransactionPrefill
}

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
  /** Restrict step to a specific platform */
  platform?: "mobile" | "desktop"
  /**
   * When set, clicking Next enters spotlight mode on this step's target
   * (or a custom target). The user must tap the spotlighted element to advance.
   */
  spotlight?: WalkthroughSpotlight
  /**
   * When set, this step stays visible while the specified overlay is open
   * and auto-advances when that overlay closes (no backdrop; high z-index).
   */
  awaitClose?: AwaitCloseTarget
  /**
   * When set, advancing from this step programmatically closes the specified overlay.
   */
  closeOnAdvance?: AwaitCloseTarget
}

export interface WalkthroughContext {
  opportunityCostEnabled: boolean
  savingsEngaged: boolean
  hasPremiumFeatures: boolean
  pendingCount: number
  isMobile: boolean
}

const MOCK_PREFILL: TransactionPrefill = {
  payee: "Coffee Shop",
  amount: "4.50",
  type: "expense",
}

export function buildWalkthroughSteps(ctx: WalkthroughContext): WalkthroughStepDef[] {
  const steps: WalkthroughStepDef[] = [
    {
      id: "dashboard-metrics",
      page: "dashboard",
      target: "dashboard-metrics",
      title: "Your month at a glance",
      description:
        "Income, what's left in your envelopes, and Savings show up here as you add activity.",
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
      description: ctx.isMobile
        ? "Home, transactions, budget, and stats are in the bar at the bottom."
        : "Dashboard, transactions, budget, and stats are in the nav on the left.",
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
      description: ctx.isMobile
        ? "Tap the orange button at the bottom to record a purchase or income. Let's try it."
        : "Click New Transaction in the sidebar to record a purchase or income. Let's try it.",
      position: "bottom",
      spotlight: {
        prompt: ctx.isMobile ? "Tap to try it" : "Click to try it",
        action: "open-new-transaction",
        prefill: MOCK_PREFILL,
      },
    },
    {
      id: "new-transaction-dialog",
      page: "transactions",
      target: "new-transaction-dialog-header",
      title: "Anatomy of a transaction",
      description:
        "Give it a payee, amount, and pick an envelope. You can tag it or make it recurring. Explore freely — the tour will wait.",
      position: "bottom",
      awaitClose: "new-transaction-dialog",
    },
    {
      id: "scan-receipt",
      page: "transactions",
      target: "scan-receipt",
      title: "Scan a receipt",
      description: "Use a photo or PDF — we suggest fields and you confirm before saving.",
      position: "right",
      platform: "desktop",
    },
    {
      id: "transaction-mode-intro",
      page: "transactions",
      target: "transaction-mode-btn",
      title: "Capture modes",
      description:
        "That button changes what the center button does — manual entry, scan receipts, or voice. Tap it to see the options.",
      position: "bottom",
      platform: "mobile",
      spotlight: {
        prompt: "Tap to see options",
        action: "open-input-mode-sheet",
      },
    },
    {
      id: "capture-modes",
      page: "transactions",
      target: "transaction-mode-btn",
      title: "Pick your default capture mode",
      description:
        "Choose what comes up when you tap Add a transaction. Great for working through a pile of receipts.",
      position: "bottom",
      platform: "mobile",
      awaitClose: "input-mode-sheet",
      closeOnAdvance: "input-mode-sheet",
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
          ? "You have transactions waiting to be reviewed. Approve them before they hit your budget."
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
        ? "Link a bank account or set up email forwarding to let BitBudget automatically record transactions. Sensitive details are encrypted the moment they arrive, so nobody but you can read them."
        : "Premium features like connected bank accounts and receipt scanning make budgeting easier. Reach out to us for a free trial.",
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

  return steps.filter((s) => {
    if (s.when && !s.when(ctx)) return false
    if (s.platform === "mobile" && !ctx.isMobile) return false
    if (s.platform === "desktop" && ctx.isMobile) return false
    return true
  })
}
