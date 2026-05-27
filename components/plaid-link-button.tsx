"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useApp } from "@/lib/app-context"
import { ONBOARDING_SESSION_STORAGE_KEY } from "@/lib/onboarding-session"
import { PlaidConnectRetryDialog } from "@/components/plaid-connect-retry-dialog"
import { plaidConnectFailureMessage, plaidLinkExitErrorMessage } from "@/lib/plaid-link-feedback"
import { Building2, Loader2 } from "lucide-react"

export interface PlaidConnectSuccessPayload {
  institutionName: string
  accounts: { accountName: string; mask: string | null; type: string }[]
}

interface PlaidLinkExitError {
  error_code?: string
  display_message?: string
  error_message?: string
}

declare global {
  interface Window {
    Plaid?: {
      create: (config: {
        token: string
        onSuccess: (
          public_token: string,
          metadata: { institution?: { name: string } },
        ) => void
        onExit: (err: PlaidLinkExitError | null, metadata: unknown) => void
        onEvent?: (eventName: string, metadata: unknown) => void
      }) => { open: () => void }
    }
  }
}

interface PlaidLinkButtonProps {
  onConnected?: (payload: PlaidConnectSuccessPayload) => void | Promise<void>
  align?: "start" | "end" | "center"
}

export function PlaidLinkButton({ onConnected, align = "end" }: PlaidLinkButtonProps) {
  const { refreshData } = useApp()
  const [loading, setLoading] = useState(false)
  const [connectError, setConnectError] = useState<string | null>(null)
  const [retryOpen, setRetryOpen] = useState(false)
  const [retryMessage, setRetryMessage] = useState("")
  const outcomeHandledRef = useRef(false)

  useEffect(() => {
    if (typeof window === "undefined") return
    if (document.getElementById("plaid-link-script")) return

    const script = document.createElement("script")
    script.id = "plaid-link-script"
    script.src = "https://cdn.plaid.com/link/v2/stable/link-initialize.js"
    script.async = true
    document.head.appendChild(script)
  }, [])

  const showConnectFailure = useCallback((message: string) => {
    if (outcomeHandledRef.current) return
    outcomeHandledRef.current = true
    setConnectError(message)
    setRetryMessage(message)
    setRetryOpen(true)
  }, [])

  const handleConnect = useCallback(async () => {
    setConnectError(null)
    setRetryOpen(false)
    setLoading(true)
    outcomeHandledRef.current = false

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
        showConnectFailure(
          plaidConnectFailureMessage({
            httpStatus: res.status,
            serverMessage:
              typeof body.message === "string"
                ? body.message
                : res.status === 503
                  ? "Bank linking isn’t available in this environment yet."
                  : res.status === 403
                    ? "Your plan doesn’t include bank sync yet."
                    : undefined,
          }),
        )
        setLoading(false)
        return
      }
      const link_token = body.link_token
      if (typeof link_token !== "string" || !link_token) {
        showConnectFailure(
          plaidConnectFailureMessage({
            serverMessage: "Couldn’t start bank linking. Try again in a moment.",
          }),
        )
        setLoading(false)
        return
      }

      const Plaid = window.Plaid
      if (!Plaid) {
        console.error("Plaid Link script not loaded")
        showConnectFailure(
          plaidConnectFailureMessage({
            serverMessage: "Bank linking script didn’t load. Refresh the page and try again.",
          }),
        )
        setLoading(false)
        return
      }

      const handler = Plaid.create({
        token: link_token,
        onSuccess: async (
          public_token: string,
          metadata: { institution?: { name: string } },
        ) => {
          let exchangeCompleted = false
          try {
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
              institutionName?: string | null
              accounts?: PlaidConnectSuccessPayload["accounts"]
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
              showConnectFailure(
                plaidConnectFailureMessage({
                  httpStatus: ex.status,
                  serverMessage:
                    typeof exchangeBody.message === "string"
                      ? exchangeBody.message
                      : typeof exchangeBody.error === "string"
                        ? exchangeBody.error
                        : undefined,
                }),
              )
              return
            }
            exchangeCompleted = true

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

            const payload: PlaidConnectSuccessPayload = {
              institutionName:
                exchangeBody.institutionName?.trim() ||
                metadata.institution?.name?.trim() ||
                "Your bank",
              accounts: Array.isArray(exchangeBody.accounts) ? exchangeBody.accounts : [],
            }

            if (onConnected) {
              await onConnected(payload)
            } else {
              await refreshData()
            }
            outcomeHandledRef.current = true
          } catch (err) {
            console.error("Plaid exchange client error:", err)
            if (outcomeHandledRef.current) return
            showConnectFailure(
              plaidConnectFailureMessage(
                exchangeCompleted
                  ? {
                      serverMessage:
                        "Your bank may already be linked. Refresh the page to check, or try again.",
                    }
                  : {},
              ),
            )
          } finally {
            setLoading(false)
          }
        },
        onExit: (err) => {
          setLoading(false)
          if (err && !outcomeHandledRef.current) {
            showConnectFailure(plaidLinkExitErrorMessage(err))
          }
        },
        onEvent: (eventName, metadata) => {
          if (eventName !== "ERROR" || outcomeHandledRef.current) return
          const meta = metadata as { error_code?: string; error_message?: string } | null
          if (!meta?.error_code && !meta?.error_message) return
          showConnectFailure(
            plaidConnectFailureMessage({
              exitError: {
                error_code: meta.error_code,
                error_message: meta.error_message,
              },
            }),
          )
        },
      })
      handler.open()
    } catch (err) {
      console.error("Plaid Link error:", err)
      showConnectFailure(plaidConnectFailureMessage({}))
      setLoading(false)
    }
  }, [onConnected, refreshData, showConnectFailure])

  const handleRetry = useCallback(() => {
    setRetryOpen(false)
    void handleConnect()
  }, [handleConnect])

  const alignClass =
    align === "center"
      ? "items-center"
      : align === "start"
        ? "items-stretch sm:items-start"
        : "items-stretch sm:items-end"

  return (
    <>
      <div className={`flex flex-col gap-2 ${alignClass}`}>
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
        {connectError && !retryOpen ? (
          <p
            className={`text-xs text-red-400 max-w-[280px] ${align === "center" ? "text-center" : "text-right"}`}
            role="alert"
          >
            {connectError}
          </p>
        ) : null}
      </div>

      <PlaidConnectRetryDialog
        open={retryOpen}
        onOpenChange={setRetryOpen}
        message={retryMessage}
        onRetry={handleRetry}
        retrying={loading}
      />
    </>
  )
}
