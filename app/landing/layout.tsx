import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "BitBudget — Bitcoin opportunity cost budgeting",
  description:
    "MIT-licensed open-source envelope budgeting with Bitcoin opportunity cost. Core features are free on bitbudget.io; optional Premium covers bank sync and AI capture.",
  openGraph: {
    title: "BitBudget — Bitcoin opportunity cost budgeting",
    description:
      "Private envelope budgeting with Bitcoin opportunity cost. Open source (MIT); Premium optional for hosted sync and capture.",
  },
}

export default function LandingLayout({ children }: { children: React.ReactNode }) {
  return children
}
