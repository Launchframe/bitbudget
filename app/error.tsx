"use client"

import { useEffect } from "react"
import * as Sentry from "@sentry/nextjs"
import { BitbudgetLogo } from "@/components/bitbudget-logo"

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    Sentry.captureException(error)
  }, [error])

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-6 text-foreground">
      <BitbudgetLogo variant="vanilla" />
      <div className="max-w-md space-y-3 text-center">
        <h1 className="text-xl font-semibold">Something went wrong</h1>
        <p className="text-sm text-muted-foreground">
          An unexpected error occurred. Our team has been notified. Please try again.
        </p>
      </div>
      <button
        type="button"
        onClick={() => reset()}
        className="rounded-xl bg-[#F7931A] px-6 py-3 text-sm font-semibold text-[#0D0D0D] hover:bg-[#F7931A]/90"
      >
        Try again
      </button>
    </div>
  )
}
