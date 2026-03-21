import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "BitBudget — Private budgeting",
  description:
    "A private, encrypted budgeting app. Allocate your income, track spending, and build better habits — your data stays yours.",
  icons: {
    icon: [{ url: "/icon-vanilla.svg", type: "image/svg+xml" }],
  },
}

export default function WelcomeLayout({ children }: { children: React.ReactNode }) {
  return children
}
