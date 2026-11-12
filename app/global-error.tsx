"use client"

import { useEffect } from "react"
import * as Sentry from "@sentry/nextjs"

export default function GlobalError({
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
    <html lang="en">
      <body className="flex min-h-screen flex-col items-center justify-center gap-6 bg-[#0D0D0D] px-6 text-[#E7E7E7]">
        <h1 className="text-xl font-semibold">BitBudget hit an error</h1>
        <p className="max-w-md text-center text-sm text-[#888]">
          Something went wrong loading the app. Please refresh or try again later.
        </p>
        <button
          type="button"
          onClick={() => reset()}
          className="rounded-xl bg-[#F7931A] px-6 py-3 text-sm font-semibold text-[#0D0D0D]"
        >
          Try again
        </button>
      </body>
    </html>
  )
}
