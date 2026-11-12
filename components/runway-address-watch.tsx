"use client"

import { useEffect, useRef, useState } from "react"
import { Loader2, RefreshCw, Trash2 } from "lucide-react"
import {
  addressWatchError,
  fetchAddressChainMovements,
  fetchAddressConfirmedSats,
  type AddressChainMovement,
} from "@/lib/esplora-address"
import { useWalletWatches } from "@/lib/use-wallet-watch"
import { writeWalletWatches, type WalletWatch } from "@/lib/wallet-watch-store"

type AddressRole = "wallet" | "exchange"

/**
 * Watch individual bitcoin addresses from the browser.
 * Change outputs are not discovered. No seed field.
 */
export function RunwayAddressWatch() {
  const watches = useWalletWatches()
  const addresses = watches.filter((watch) => watch.kind === "address")
  const [address, setAddress] = useState("")
  const [role, setRole] = useState<AddressRole>("wallet")
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [activity, setActivity] = useState<Record<string, AddressChainMovement[]>>({})
  const [activityError, setActivityError] = useState<Record<string, boolean>>({})
  const addressKey = addresses.map((watch) => `${watch.id}:${watch.descriptor}`).join("|")
  const addressesRef = useRef(addresses)
  addressesRef.current = addresses

  useEffect(() => {
    const current = addressesRef.current
    if (current.length === 0) return
    let cancelled = false
    for (const watch of current) {
      void fetchAddressChainMovements(watch.descriptor)
        .then((rows) => {
          if (cancelled) return
          setActivity((prev) => ({ ...prev, [watch.id]: rows }))
          setActivityError((prev) => ({ ...prev, [watch.id]: false }))
        })
        .catch(() => {
          if (cancelled) return
          setActivityError((prev) => ({ ...prev, [watch.id]: true }))
        })
    }
    return () => {
      cancelled = true
    }
  }, [addressKey])

  async function refreshOne(watch: WalletWatch, list: readonly WalletWatch[]) {
    const sats = await fetchAddressConfirmedSats(watch.descriptor)
    const updatedAt = new Date().toISOString()
    writeWalletWatches(
      list.map((row) =>
        row.id === watch.id ? { ...row, confirmedSats: sats, updatedAt } : row,
      ),
    )
  }

  async function onAdd() {
    const problem = addressWatchError(address)
    if (problem) {
      setError(problem)
      return
    }
    const descriptor = address.trim()
    if (addresses.some((watch) => watch.descriptor === descriptor)) {
      setError("That address is already on the list.")
      return
    }
    const next: WalletWatch = {
      id: crypto.randomUUID(),
      label: role === "exchange" ? "Exchange" : "Wallet",
      role,
      kind: "address",
      descriptor,
      confirmedSats: 0,
      updatedAt: null,
    }
    const list = [...watches, next]
    writeWalletWatches(list)
    setAddress("")
    setError(null)
    setBusyId(next.id)
    try {
      await refreshOne(next, list)
      const rows = await fetchAddressChainMovements(next.descriptor)
      setActivity((prev) => ({ ...prev, [next.id]: rows }))
      setActivityError((prev) => ({ ...prev, [next.id]: false }))
    } catch {
      setError("Couldn't look up that address. Try again.")
    } finally {
      setBusyId(null)
    }
  }

  async function onRefresh(watch: WalletWatch) {
    setBusyId(watch.id)
    setError(null)
    try {
      await refreshOne(watch, watches)
      const rows = await fetchAddressChainMovements(watch.descriptor)
      setActivity((prev) => ({ ...prev, [watch.id]: rows }))
      setActivityError((prev) => ({ ...prev, [watch.id]: false }))
    } catch {
      setError("Couldn't look up that address. Try again.")
    } finally {
      setBusyId(null)
    }
  }

  function onRemove(id: string) {
    writeWalletWatches(watches.filter((watch) => watch.id !== id))
  }

  return (
    <div className="flex flex-col gap-3 border-t border-[#1F1F1F] pt-3">
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">Addresses you watch</p>
        <p className="text-xs text-muted-foreground mt-1">
          Watching one address misses change. Wallets send leftover bitcoin to a new address, so
          one address can show too little. Add each address you want counted. The lookup runs in
          your browser and the address is not sent to BitBudget.
        </p>
      </div>

      {addresses.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {addresses.map((watch) => (
            <li
              key={watch.id}
              className="flex flex-col gap-2 rounded-xl border border-[#1F1F1F] bg-[#1A1A1A]/40 p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="text-sm text-foreground">
                  {watch.role === "exchange" ? "Exchange" : "Wallet"}
                  <span className="text-muted-foreground"> · {formatBitcoin(watch.confirmedSats)}</span>
                </p>
                <p className="text-xs text-muted-foreground break-all">{watch.descriptor}</p>
                <AddressActivity
                  rows={activity[watch.id]}
                  failed={activityError[watch.id] === true}
                />
              </div>
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  onClick={() => void onRefresh(watch)}
                  disabled={busyId === watch.id}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[#333] px-3 py-2 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
                  aria-label="Refresh this address"
                >
                  {busyId === watch.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                  )}
                  Refresh
                </button>
                <button
                  type="button"
                  onClick={() => onRemove(watch.id)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[#333] px-3 py-2 text-xs text-muted-foreground hover:text-red-400"
                  aria-label="Remove this address"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex flex-col gap-2">
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            placeholder="Bitcoin address"
            autoComplete="off"
            spellCheck={false}
            aria-label="Bitcoin address"
            className="min-w-0 w-full rounded-lg border border-[#333] bg-[#1A1A1A] px-3 py-2 text-sm text-foreground"
          />
          <button
            type="button"
            onClick={() => void onAdd()}
            className="w-full shrink-0 rounded-lg bg-[#F7931A] px-4 py-2 text-sm font-semibold text-[#0D0D0D] hover:bg-[#F7931A]/90 sm:w-auto"
          >
            Add address
          </button>
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="What this address is">
          <RoleButton current={role} value="wallet" onSelect={setRole} label="Wallet I spend from" />
          <RoleButton current={role} value="exchange" onSelect={setRole} label="Exchange" />
        </div>
        {error ? (
          <p className="text-xs text-red-400" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  )
}

function AddressActivity({
  rows,
  failed,
}: {
  rows: AddressChainMovement[] | undefined
  failed: boolean
}) {
  if (failed && rows == null) {
    return (
      <p className="text-xs text-muted-foreground mt-2">
        Couldn&apos;t load activity for this address.
      </p>
    )
  }
  if (rows == null) return null
  const latest = rows.slice(0, 6)
  if (latest.length === 0) {
    return (
      <p className="text-xs text-muted-foreground mt-2">No confirmed activity on this address yet.</p>
    )
  }
  return (
    <div className="mt-2 flex flex-col gap-1">
      <p className="text-[11px] text-muted-foreground">
        Recent activity. These rows are not spending or income.
      </p>
      <ul className="flex flex-col gap-1">
        {latest.map((row) => (
          <li key={row.txid} className="text-xs text-foreground break-words">
            {row.netSats > 0 ? "Received" : "Sent"} {formatBitcoin(row.netSats)}
            {row.time != null ? ` · ${formatChainDay(row.time)}` : ""}
          </li>
        ))}
      </ul>
    </div>
  )
}

function formatBitcoin(sats: number): string {
  const btc = Math.abs(sats) / 100_000_000
  const text = btc.toFixed(8).replace(/0+$/, "").replace(/\.$/, "")
  return `${text} bitcoin`
}

function formatChainDay(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  })
}

function RoleButton({
  current,
  value,
  label,
  onSelect,
}: {
  current: AddressRole
  value: AddressRole
  label: string
  onSelect: (value: AddressRole) => void
}) {
  const selected = current === value
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={() => onSelect(value)}
      className={`rounded-full border px-3 py-1.5 text-xs ${
        selected
          ? "border-[#F7931A] text-[#F7931A]"
          : "border-[#333] text-muted-foreground hover:text-foreground"
      }`}
    >
      {label}
    </button>
  )
}
