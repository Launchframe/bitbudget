"use client"

import { useCallback, useEffect, useState } from "react"
import { useApp } from "@/lib/app-context"
import { Building2, Loader2 } from "lucide-react"

declare global {
  interface Window {
    Plaid?: {
      create: (config: {
        token: string
        onSuccess: (
          public_token: string,
          metadata: { institution?: { name: string } },
        ) => void
        onExit: () => void
      }) => { open: () => void }
    }
  }
}

export function PlaidLinkButton() {
  const { refreshData } = useApp()
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (typeof window === "undefined") return
    if (document.getElementById("plaid-link-script")) return

    const script = document.createElement("script")
    script.id = "plaid-link-script"
    script.src = "https://cdn.plaid.com/link/v2/stable/link-initialize.js"
    script.async = true
    document.head.appendChild(script)
  }, [])

  const handleConnect = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/plaid/create-link-token", {
        method: "POST",
      })
      if (!res.ok) throw new Error("Failed to create link token")
      const { link_token } = (await res.json()) as { link_token: string }

      const Plaid = window.Plaid
      if (!Plaid) {
        console.error("Plaid Link script not loaded")
        setLoading(false)
        return
      }

      const handler = Plaid.create({
        token: link_token,
        onSuccess: async (
          public_token: string,
          metadata: { institution?: { name: string } },
        ) => {
          const ex = await fetch("/api/plaid/exchange-token", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              public_token,
              institution: metadata.institution,
            }),
          })
          if (ex.ok) {
            try {
              const body = (await ex.json()) as {
                referralActivated?: boolean
                referralTrialMonths?: number | null
              }
              if (body.referralActivated && body.referralTrialMonths != null) {
                sessionStorage.setItem("bitbudget-trial-welcome", "1")
              }
            } catch {
              /* ignore */
            }
          }
          await refreshData()
          window.location.reload()
        },
        onExit: () => setLoading(false),
      })
      handler.open()
    } catch (err) {
      console.error("Plaid Link error:", err)
      setLoading(false)
    }
  }, [refreshData])

  return (
    <button
      onClick={handleConnect}
      disabled={true}
      className="flex items-center gap-3 px-4 py-3 bg-[#1A1A1A] border border-[#333] rounded-xl text-sm text-foreground hover:border-btc-orange/50 transition-colors disabled:opacity-50"
    >
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Building2 className="h-4 w-4 text-btc-orange" />
      )}
      Coming Soon!
    </button>
  )
}
