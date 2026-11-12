"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Trophy } from "lucide-react"
import { useApp } from "@/lib/app-context"
import { ACHIEVEMENT_LABELS } from "@/lib/savings-ui-metrics"

interface AchievementRow {
  code: string
  earnedAt: string
}

const POLL_MS = 45_000

export function AchievementCelebrationHost() {
  const { currentUserId } = useApp()
  const seenRef = useRef<Set<string>>(new Set())
  const initializedRef = useRef(false)
  const initPromiseRef = useRef<Promise<void> | null>(null)
  const initUserIdRef = useRef<string | null>(null)
  const [toast, setToast] = useState<{ code: string; label: string } | null>(null)

  const ensureSeenInitialized = useCallback(async () => {
    if (!currentUserId) return
    if (initializedRef.current && initUserIdRef.current === currentUserId) return

    if (!initPromiseRef.current || initUserIdRef.current !== currentUserId) {
      const userId = currentUserId
      initUserIdRef.current = userId
      initializedRef.current = false
      initPromiseRef.current = (async () => {
        try {
          const res = await fetch("/api/user/achievements?limit=100")
          if (!res.ok) return
          if (initUserIdRef.current !== userId) return
          const body = (await res.json()) as { achievements?: AchievementRow[] }
          for (const row of body.achievements ?? []) {
            seenRef.current.add(row.code)
          }
        } catch {
          /* ignore */
        } finally {
          if (initUserIdRef.current === userId) {
            initializedRef.current = true
          }
        }
      })()
    }
    await initPromiseRef.current
  }, [currentUserId])

  const syncAchievements = useCallback(async () => {
    if (!currentUserId) return
    try {
      await fetch("/api/user/achievements", { method: "POST" })
    } catch {
      /* ignore */
    }
  }, [currentUserId])

  const pollAchievements = useCallback(async () => {
    if (!currentUserId) return
    await ensureSeenInitialized()
    try {
      const res = await fetch("/api/user/achievements?limit=100")
      if (!res.ok) return
      const body = (await res.json()) as { achievements?: AchievementRow[] }
      const rows = body.achievements ?? []

      for (const row of rows) {
        if (seenRef.current.has(row.code)) continue
        seenRef.current.add(row.code)
        const label = ACHIEVEMENT_LABELS[row.code] ?? row.code
        setToast({ code: row.code, label })
        return
      }
    } catch {
      /* ignore */
    }
  }, [currentUserId, ensureSeenInitialized])

  useEffect(() => {
    seenRef.current = new Set()
    initializedRef.current = false
    initPromiseRef.current = null
    initUserIdRef.current = currentUserId
    const t = window.setTimeout(() => void ensureSeenInitialized(), 0)
    return () => window.clearTimeout(t)
  }, [currentUserId, ensureSeenInitialized])

  useEffect(() => {
    if (!currentUserId) return
    const id = window.setInterval(() => void pollAchievements(), POLL_MS)
    const onFocus = () => void pollAchievements()
    const onPollRequest = () => {
      void syncAchievements().then(() => pollAchievements())
    }
    window.addEventListener("focus", onFocus)
    window.addEventListener("bitbudget-achievements-poll", onPollRequest)
    return () => {
      window.clearInterval(id)
      window.removeEventListener("focus", onFocus)
      window.removeEventListener("bitbudget-achievements-poll", onPollRequest)
    }
  }, [currentUserId, pollAchievements, syncAchievements])

  useEffect(() => {
    if (!toast) return
    const t = window.setTimeout(() => setToast(null), 5500)
    return () => window.clearTimeout(t)
  }, [toast])

  if (!toast) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-20 md:bottom-6 left-1/2 -translate-x-1/2 z-[60] max-w-[min(96vw,20rem)] px-4 py-3 rounded-2xl shadow-lg border border-[#333] bg-[#1A1A1A] flex items-center gap-3 animate-in fade-in slide-in-from-bottom-2 duration-300"
    >
      <div className="shrink-0 p-2 rounded-full bg-[#F7931A]/20">
        <Trophy className="h-5 w-5 text-[#F7931A]" aria-hidden />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">Achievement unlocked</p>
        <p className="text-sm font-semibold text-foreground truncate">{toast.label}</p>
      </div>
    </div>
  )
}
