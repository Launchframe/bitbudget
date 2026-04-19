"use client"

import { useCallback, useEffect, useState } from "react"
import { useApp } from "@/lib/app-context"
import { ONBOARDING_SESSION_STORAGE_KEY } from "@/lib/onboarding-session"
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
  const [connectError, setConnectError] = useState<string | null>(null)

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
    setConnectError(null)
    setLoading(true)
    try {
      const res = await fetch("/api/plaid/create-link-token", {
        method: "POST",
      })
      const body = (await res.json().catch(() => ({}))) as {
        link_token?: string
        error?: string
        message?: string
      }
      if (!res.ok) {
        const msg =
          typeof body.message === "string"
            ? body.message
            : res.status === 503
              ? "Bank linking isn’t available in this environment yet."
              : res.status === 403
                ? "Your plan doesn’t include bank sync yet."
                : "Couldn’t start bank linking. Try again in a moment."
        setConnectError(msg)
        setLoading(false)
        return
      }
      const link_token = body.link_token
      if (typeof link_token !== "string" || !link_token) {
        setConnectError("Couldn’t start bank linking. Try again in a moment.")
        setLoading(false)
        return
      }

      const Plaid = window.Plaid
      if (!Plaid) {
        console.error("Plaid Link script not loaded")
        setConnectError("Bank linking script didn’t load. Refresh the page and try again.")
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
          const raw = await ex.text()
          let exchangeBody: {
            referralActivated?: boolean
            referralTrialMonths?: number | null
            error?: string
            message?: string
          } = {}
          try {
            exchangeBody = raw ? (JSON.parse(raw) as typeof exchangeBody) : {}
          } catch {
            /* ignore */
          }
          if (!ex.ok) {
            let msg = "Bank link didn’t finish saving. Try again."
            if (typeof exchangeBody.message === "string" && exchangeBody.message.trim()) {
              msg = exchangeBody.message.trim()
            } else if (typeof exchangeBody.error === "string" && exchangeBody.error.trim()) {
              msg = exchangeBody.error.trim()
            }
            setConnectError(msg)
            setLoading(false)
            return
          }
          if (exchangeBody.referralActivated && exchangeBody.referralTrialMonths != null) {
            try {
              sessionStorage.setItem("bitbudget-trial-welcome", "1")
            } catch {
              /* ignore */
            }
          }
          try {
            sessionStorage.removeItem(ONBOARDING_SESSION_STORAGE_KEY)
          } catch {
            /* ignore */
          }
          await refreshData()
          window.location.reload()
        },
        onExit: () => setLoading(false),
      })
      handler.open()
    } catch (err) {
      console.error("Plaid Link error:", err)
      setConnectError("Something went wrong. Try again in a moment.")
      setLoading(false)
    }
  }, [refreshData])

  return (
    <div className="flex flex-col items-stretch gap-2 sm:items-end">
      <button
        type="button"
        onClick={() => void handleConnect()}
        disabled={loading}
        className="flex items-center gap-3 px-4 py-3 bg-[#1A1A1A] border border-[#333] rounded-xl text-sm text-foreground hover:border-btc-orange/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin shrink-0" />
        ) : (
          <Building2 className="h-4 w-4 text-btc-orange shrink-0" />
        )}
        {loading ? "Opening…" : "Connect bank"}
      </button>
      {connectError ? (
        <p className="text-xs text-red-400 max-w-[280px] text-right" role="alert">
          {connectError}
        </p>
      ) : null}
    </div>
  )
}
