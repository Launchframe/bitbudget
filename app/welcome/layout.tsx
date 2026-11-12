import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "BitBudget — Private budgeting (vanilla view)",
  description:
    "MIT-licensed private envelope budgeting without Bitcoin opportunity-cost UI. Core features free; optional Premium on bitbudget.io for bank sync and AI capture.",
  icons: {
    icon: [{ url: "/icon-vanilla.svg", type: "image/svg+xml" }],
  },
}

export default function WelcomeLayout({ children }: { children: React.ReactNode }) {
  return children
}
