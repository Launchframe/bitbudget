"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { captureInviteFromLocation } from "@/lib/shopping-invite-handoff"

/**
 * Captures the invite token from the URL fragment (never sent to the server as a path)
 * and hands it off through session storage across sign-in / Secure Your Data.
 */
export default function ShoppingInvitePage() {
  const router = useRouter()

  useEffect(() => {
    const captured = captureInviteFromLocation(window.location.hash, () => {
      window.history.replaceState(null, "", "/shopping-invite")
    })
    router.replace(captured ? "/#/shopping" : "/")
  }, [router])

  return (
    <div className="min-h-screen bg-[#0D0D0D] text-white flex items-center justify-center p-6">
      <p className="text-sm text-white/70">Opening your invite…</p>
    </div>
  )
}
