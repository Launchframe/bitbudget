"use client"

import { useCallback, useEffect, useState } from "react"
import { Building2, Loader2, Unlink } from "lucide-react"
import { useApp } from "@/lib/app-context"
import { PlaidLinkButton, type PlaidConnectSuccessPayload } from "@/components/plaid-link-button"
import { PlaidConnectSuccessDialog } from "@/components/plaid-connect-success-dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  formatPlaidAccountLabel,
  formatPlaidInstitutionTitle,
} from "@/lib/plaid-connection-labels"

interface PlaidConnectionAccount {
  id: string
  accountName: string
  mask: string | null
  type: string
}

interface PlaidConnectionItem {
  id: string
  institutionName: string | null
  createdAt: string
  accounts: PlaidConnectionAccount[]
}

interface PlaidConnectionsSectionProps {
  canConnect: boolean
  connectAlign?: "start" | "end" | "center"
}

export function PlaidConnectionsSection({
  canConnect,
  connectAlign = "end",
}: PlaidConnectionsSectionProps) {
  const { refreshData } = useApp()
  const [items, setItems] = useState<PlaidConnectionItem[]>([])
  const [loadingItems, setLoadingItems] = useState(true)
  const [successPayload, setSuccessPayload] = useState<PlaidConnectSuccessPayload | null>(null)
  const [successOpen, setSuccessOpen] = useState(false)
  const [disconnectTarget, setDisconnectTarget] = useState<PlaidConnectionItem | null>(null)
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null)
  const [disconnectError, setDisconnectError] = useState<string | null>(null)

  const loadItems = useCallback(async () => {
    setLoadingItems(true)
    try {
      const res = await fetch("/api/plaid/items")
      if (!res.ok) {
        setItems([])
        return
      }
      const body = (await res.json()) as { items?: PlaidConnectionItem[] }
      setItems(Array.isArray(body.items) ? body.items : [])
    } catch {
      setItems([])
    } finally {
      setLoadingItems(false)
    }
  }, [])

  useEffect(() => {
    void loadItems()
  }, [loadItems])

  const handleConnected = useCallback(
    async (payload: PlaidConnectSuccessPayload) => {
      setSuccessPayload(payload)
      setSuccessOpen(true)
      await Promise.all([loadItems(), refreshData()])
    },
    [loadItems, refreshData],
  )

  const handleDisconnect = useCallback(async () => {
    if (!disconnectTarget) return
    setDisconnectError(null)
    setDisconnectingId(disconnectTarget.id)
    try {
      const res = await fetch(`/api/plaid/items/${disconnectTarget.id}`, {
        method: "DELETE",
      })
      const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string }
      if (!res.ok) {
        const msg =
          typeof body.message === "string"
            ? body.message
            : typeof body.error === "string"
              ? body.error
              : "Couldn’t disconnect this bank. Try again."
        setDisconnectError(msg)
        return
      }
      setDisconnectTarget(null)
      await Promise.all([loadItems(), refreshData()])
    } catch {
      setDisconnectError("Couldn’t disconnect this bank. Try again.")
    } finally {
      setDisconnectingId(null)
    }
  }, [disconnectTarget, loadItems, refreshData])

  const alignClass =
    connectAlign === "center"
      ? "items-center"
      : connectAlign === "start"
        ? "items-start"
        : "items-stretch sm:items-end"

  const connectionCards = items.map((item) => {
    const title = formatPlaidInstitutionTitle(item.institutionName)
    const isDisconnecting = disconnectingId === item.id
    return (
      <div key={item.id} className="rounded-xl border border-[#333] bg-[#141414] p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-2">
            <div className="flex items-center gap-2">
              <Building2 className="h-4 w-4 shrink-0 text-btc-orange" aria-hidden />
              <p className="font-medium text-foreground truncate">{title}</p>
            </div>
            <ul className="space-y-1 pl-6 text-sm text-muted-foreground">
              {item.accounts.map((account) => (
                <li key={account.id}>{formatPlaidAccountLabel(account)}</li>
              ))}
            </ul>
          </div>
          <button
            type="button"
            onClick={() => {
              setDisconnectError(null)
              setDisconnectTarget(item)
            }}
            disabled={isDisconnecting}
            className="inline-flex shrink-0 items-center justify-center gap-2 self-start rounded-lg border border-[#333] px-3 py-2 text-sm text-muted-foreground transition-colors hover:border-red-500/40 hover:text-red-400 disabled:opacity-50"
            aria-label={`Disconnect ${title}`}
          >
            {isDisconnecting ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Unlink className="h-4 w-4" aria-hidden />
            )}
            Disconnect
          </button>
        </div>
      </div>
    )
  })

  return (
    <>
      <div className="flex flex-col gap-4">
        {loadingItems ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin shrink-0" aria-hidden />
            Loading connected banks…
          </div>
        ) : items.length > 0 ? (
          <div className="space-y-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Connected banks
            </p>
            {connectionCards}
          </div>
        ) : null}

        {canConnect ? (
          <div className={`flex flex-col gap-2 ${alignClass}`}>
            <PlaidLinkButton onConnected={handleConnected} align={connectAlign} />
          </div>
        ) : null}

        {disconnectError ? (
          <p className="text-xs text-red-400" role="alert">
            {disconnectError}
          </p>
        ) : null}
      </div>

      <PlaidConnectSuccessDialog
        open={successOpen}
        onOpenChange={setSuccessOpen}
        payload={successPayload}
      />

      <AlertDialog
        open={disconnectTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDisconnectTarget(null)
            setDisconnectError(null)
          }
        }}
      >
        <AlertDialogContent className="border-[#1F1F1F] bg-[#0D0D0D] text-foreground">
          <AlertDialogHeader>
            <AlertDialogTitle>
              Disconnect {formatPlaidInstitutionTitle(disconnectTarget?.institutionName ?? null)}?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              Transactions already imported will stay in BitBudget. New transactions from this bank
              will stop syncing.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {disconnectError ? (
            <p className="text-sm text-red-400" role="alert">
              {disconnectError}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel className="border-[#333] bg-transparent">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-600/90"
              disabled={disconnectingId !== null}
              onClick={(e) => {
                e.preventDefault()
                void handleDisconnect()
              }}
            >
              {disconnectingId ? "Disconnecting…" : "Disconnect"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
