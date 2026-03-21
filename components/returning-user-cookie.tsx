"use client"

import { useEffect } from "react"
import { useSession } from "next-auth/react"

/**
 * Marks the browser as a returning user only after a successful sign-in.
 * Middleware uses `bitbudget_visited` to send anonymous visitors on `/` to `/auth`
 * instead of `/welcome`, without blocking `/welcome` or `/landing` for anyone.
 */
export function ReturningUserCookie() {
  const { status } = useSession()

  useEffect(() => {
    if (status !== "authenticated") return
    document.cookie = "bitbudget_visited=1; path=/; max-age=31536000; SameSite=Lax"
  }, [status])

  return null
}
