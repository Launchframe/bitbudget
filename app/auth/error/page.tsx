import type { Metadata } from "next"
import Link from "next/link"
import { authErrorMessage } from "@/lib/auth-errors"

export const metadata: Metadata = {
  title: "Sign-in error | BitBudget",
  description: "There was a problem signing in to BitBudget.",
}

export default async function AuthErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const sp = await searchParams
  const errorCode = sp.error ?? "Default"
  const message = authErrorMessage(errorCode)

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-[#0D0D0D] px-6 py-16 text-center">
      <p className="text-sm font-medium uppercase tracking-wider text-muted-foreground">Sign-in error</p>
      <h1 className="mt-2 text-2xl font-bold text-foreground sm:text-3xl">We could not complete sign-in</h1>
      <p className="mt-3 max-w-md text-sm text-muted-foreground">{message}</p>
      {errorCode !== "Default" && (
        <p className="mt-2 text-xs text-muted-foreground">Error code: {errorCode}</p>
      )}
      <nav
        className="mt-10 flex flex-col items-stretch gap-3 sm:flex-row sm:flex-wrap sm:justify-center"
        aria-label="Helpful links"
      >
        <Link
          href="/auth"
          className="rounded-xl bg-btc-orange px-6 py-3 text-center text-sm font-semibold text-[#0D0D0D] transition-colors hover:bg-btc-orange/90"
        >
          Try signing in again
        </Link>
        <Link
          href="/"
          className="rounded-xl border border-[#333] bg-[#1A1A1A] px-6 py-3 text-center text-sm font-medium text-foreground transition-colors hover:bg-[#222]"
        >
          App home
        </Link>
        <Link
          href="/welcome"
          className="rounded-xl border border-[#333] bg-[#1A1A1A] px-6 py-3 text-center text-sm font-medium text-foreground transition-colors hover:bg-[#222]"
        >
          Welcome
        </Link>
      </nav>
    </div>
  )
}
