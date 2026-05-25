"use client"

import { useEffect, useState } from "react"
import { CloudOff, RefreshCw } from "lucide-react"
import { useApp } from "@/lib/app-context"
import { countPendingMutations, isBrowserOffline } from "@/lib/offline-queue"

export function OfflineStatusBanner() {
  const { state, currentUserId } = useApp()
  const [offline, setOffline] = useState(false)
  const [queued, setQueued] = useState(0)
  const userId = currentUserId

  useEffect(() => {
    const sync = () => setOffline(isBrowserOffline())
    sync()
    window.addEventListener("online", sync)
    window.addEventListener("offline", sync)
    return () => {
      window.removeEventListener("online", sync)
      window.removeEventListener("offline", sync)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!userId) {
        setQueued(0)
        return
      }
      const n = await countPendingMutations(userId)
      if (!cancelled) setQueued(n)
    }
    void load()
    const id = window.setInterval(() => void load(), 5000)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [userId, state.transactions])

  const pendingUi = state.transactions.filter((t) => t.pendingSync).length
  const totalPending = Math.max(queued, pendingUi)

  if (!offline && totalPending === 0) return null

  return (
    <div
      role="status"
      className="flex items-start gap-2 rounded-xl border border-[#F7931A]/30 bg-[#F7931A]/10 px-3 py-2 text-sm text-foreground min-w-0"
    >
      {offline ? (
        <CloudOff className="h-4 w-4 shrink-0 text-[#F7931A] mt-0.5" aria-hidden />
      ) : (
        <RefreshCw className="h-4 w-4 shrink-0 text-[#F7931A] mt-0.5 animate-spin" aria-hidden />
      )}
      <p className="min-w-0 leading-snug">
        {offline ? (
          <>
            You&apos;re offline. New transactions are saved on this device and will upload when you&apos;re back on
            your network{totalPending > 0 ? ` (${totalPending} waiting)` : ""}.
          </>
        ) : (
          <>Syncing {totalPending} transaction{totalPending === 1 ? "" : "s"} to your server…</>
        )}
      </p>
    </div>
  )
}
