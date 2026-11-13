/**
 * Shared public marketing copy for /landing (Bitcoin) and /welcome (vanilla).
 * Keep claims in one place so the two routes do not drift.
 */

export const MARKETING_SOURCE_REPO_URL = "https://github.com/Launchframe/bitbudget"

/** Founder-approved encryption feature card (Private tier today). */
export const MARKETING_ENCRYPTED_PAYEES_NOTES = {
  title: "Encrypted payees & notes",
  body: "Who you transact with is your business, so transaction payees and notes are encrypted on your device before they reach our servers. Amounts, dates, and categories stay visible so income and reports can be delivered to you.",
} as const

export const MARKETING_ENVELOPE_BUDGETING = {
  title: "Envelope Budgeting",
  description:
    "Organize spending into envelopes — Rent, Food, Entertainment, and more. Allocate your income and track where every dollar goes.",
} as const

/** Shared CTA / trust paragraph (MIT, free core, optional Premium). */
export const MARKETING_TRUST_PARAGRAPH =
  "envelope budgeting and encryption are free on bitbudget.io. Optional Premium covers live bank sync and AI-powered capture so we can pay for Plaid and model usage—never required for private manual budgeting."

export const MARKETING_TRUST_TAIL =
  "No ads, no data selling, no ad-tech tracking."

/** Footer suffix shared by both variants. */
export const MARKETING_FOOTER_SUFFIX =
  "End-to-end encrypted payees and notes. Optional Premium on bitbudget.io for hosted sync and capture."

export const MARKETING_CTA_BUTTON_LABEL = "Get Started — Core budgeting is free"

export const MARKETING_HEADER_GET_STARTED = "Get Started"

export type MarketingPitchVariant = "btc" | "vanilla"

export type MarketingHowItWorksStep = {
  step: string
  title: string
  description: string
}

const HOW_BUDGET_SETUP: MarketingHowItWorksStep = {
  step: "2",
  title: "Set up your budget",
  description:
    "Enter your income, create envelopes for your spending categories, and allocate your paycheck.",
}

const HOW_LOG_TXNS: MarketingHowItWorksStep = {
  step: "3",
  title: "Log transactions",
  description: "Record expenses as they happen, or import your transaction history from a CSV.",
}

export const MARKETING_VARIANT_CONFIG: Record<
  MarketingPitchVariant,
  {
    onboardingSource: "btc" | "vanilla"
    logoVariant: "default" | "vanilla"
    footerLead: string
    crossPitchLink: { href: string; label: string }
    cta: { title: string; leadSentence: string | null }
    hero: {
      pitchSwitchBanner: { href: string; label: string } | null
      badge: { className: string; icon: "zap" | "pie"; label: string }
      subhead: string
      primaryCta: string
    }
    features: {
      highlight: { icon: "trending" | "bar-chart"; title: string; description: string; accentClass: string }
    }
    howItWorks: MarketingHowItWorksStep[]
  }
> = {
  btc: {
    onboardingSource: "btc",
    logoVariant: "default",
    footerLead: "MIT-licensed Bitcoin opportunity cost envelope budgeting.",
    crossPitchLink: {
      href: "/welcome",
      label: "Prefer budgeting without Bitcoin UI? →",
    },
    cta: {
      title: "Ready to see the true cost of spending?",
      leadSentence: "Join the Bitcoiners who are rethinking every purchase.",
    },
    hero: {
      pitchSwitchBanner: null,
      badge: {
        className: "bg-[#F7931A]/10 border-[#F7931A]/20 text-[#F7931A]",
        icon: "zap",
        label: "Powered by the Bitcoin standard",
      },
      subhead:
        "BitBudget tracks the opportunity cost of your spending in Bitcoin terms. See what your purchases would be worth today — and think twice before your next expense.",
      primaryCta: "Start Tracking",
    },
    features: {
      highlight: {
        icon: "trending",
        title: "Opportunity Cost Tracking",
        description:
          "Every transaction shows what it would be worth in Bitcoin today. Watch your spending history transform into a powerful savings motivator.",
        accentClass: "text-[#F7931A]",
      },
    },
    howItWorks: [
      {
        step: "1",
        title: "Sign in with Nostr or email",
        description:
          "Use your Nostr extension for cypherpunk-grade auth, or sign in with email, Google, or GitHub.",
      },
      HOW_BUDGET_SETUP,
      HOW_LOG_TXNS,
      {
        step: "4",
        title: "See the opportunity cost",
        description:
          "Every dollar spent is shown alongside what it would be worth in Bitcoin today. Stack sats smarter.",
      },
    ],
  },
  vanilla: {
    onboardingSource: "vanilla",
    logoVariant: "vanilla",
    footerLead: "MIT-licensed envelope budgeting (vanilla view).",
    crossPitchLink: {
      href: "/landing",
      label: "Looking for the Bitcoin opportunity cost experience? →",
    },
    cta: {
      title: "Ready to take control of your finances?",
      leadSentence: null,
    },
    hero: {
      pitchSwitchBanner: {
        href: "/landing",
        label: "Bitcoin-first product — see opportunity cost in sats on the main pitch →",
      },
      badge: {
        className: "bg-[#3B82F6]/10 border-[#3B82F6]/20 text-[#3B82F6]",
        icon: "pie",
        label: "Simple. Private. Yours. (no Bitcoin UI)",
      },
      subhead:
        "BitBudget is a private, encrypted envelope budgeting app. This page is the streamlined view without Bitcoin opportunity-cost charts—same ledger, same encryption, different presentation.",
      primaryCta: "Start Budgeting — Free",
    },
    features: {
      highlight: {
        icon: "bar-chart",
        title: "Spending Insights",
        description:
          "Visualize your spending patterns over time. Understand your habits and make informed decisions about your money.",
        accentClass: "text-[#3B82F6]",
      },
    },
    howItWorks: [
      {
        step: "1",
        title: "Sign in securely",
        description:
          "Use your email, Google, or GitHub account. Payees and notes are encrypted on your device; amounts, dates, and categories stay visible so income and reports can be delivered to you.",
      },
      HOW_BUDGET_SETUP,
      HOW_LOG_TXNS,
      {
        step: "4",
        title: "Build better habits",
        description:
          "Review your spending trends and see where adjustments can help you save more and stress less.",
      },
    ],
  },
}
