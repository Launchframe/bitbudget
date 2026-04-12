import type { Metadata } from "next"
import Link from "next/link"

export const metadata: Metadata = {
  title: "Page not found | BitBudget",
  description: "This page does not exist or has moved.",
}

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-[#0D0D0D] px-6 py-16 text-center">
      <p className="text-sm font-medium uppercase tracking-wider text-muted-foreground">404</p>
      <h1 className="mt-2 text-2xl font-bold text-foreground sm:text-3xl">This page could not be found</h1>
      <p className="mt-3 max-w-md text-sm text-muted-foreground">
        The link may be wrong, out of date, or the page was removed. Head back to BitBudget and keep
        budgeting.
      </p>
      <nav
        className="mt-10 flex flex-col items-stretch gap-3 sm:flex-row sm:flex-wrap sm:justify-center"
        aria-label="Helpful links"
      >
        <Link
          href="/"
          className="rounded-xl bg-btc-orange px-6 py-3 text-center text-sm font-semibold text-[#0D0D0D] transition-colors hover:bg-btc-orange/90"
        >
          App home
        </Link>
        <Link
          href="/welcome"
          className="rounded-xl border border-[#333] bg-[#1A1A1A] px-6 py-3 text-center text-sm font-medium text-foreground transition-colors hover:bg-[#222]"
        >
          Welcome
        </Link>
        <Link
          href="/auth"
          className="rounded-xl border border-[#333] bg-[#1A1A1A] px-6 py-3 text-center text-sm font-medium text-foreground transition-colors hover:bg-[#222]"
        >
          Sign in
        </Link>
      </nav>
    </div>
  )
}
