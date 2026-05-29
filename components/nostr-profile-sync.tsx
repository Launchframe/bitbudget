"use client"

import { useEffect, useRef } from "react"
import { useSession } from "next-auth/react"
import { runNostrProfileBackgroundSync } from "@/lib/nostr-profile-sync-client"

/** Background relay fetch for Nostr users missing name/avatar after login. */
export function NostrProfileSync() {
  const { status, update } = useSession()
  const syncStartedRef = useRef(false)

  useEffect(() => {
    if (status !== "authenticated") {
      syncStartedRef.current = false
      return
    }
    if (syncStartedRef.current) return

    // Set synchronously so a concurrent effect invocation (Strict Mode double-fire
    // or unstable `update` reference) sees the guard before the first fetch returns.
    syncStartedRef.current = true
    let cancelled = false

    void (async () => {
      try {
        const res = await fetch("/api/user/nostr-profile")
        if (!res.ok || cancelled) return
        const data = (await res.json()) as {
          needsSync?: boolean
          nostrPubkey?: string | null
        }
        if (!data.needsSync || !data.nostrPubkey?.trim() || cancelled) return

        await runNostrProfileBackgroundSync(data.nostrPubkey, update)
      } catch {
        /* non-fatal — user can keep using the app */
      }
    })()

    return () => {
      cancelled = true
    }
  }, [status, update])

  return null
}
