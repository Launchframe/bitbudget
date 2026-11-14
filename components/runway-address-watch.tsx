"use client"

import { useRef, useState } from "react"
import { Loader2, RefreshCw, Trash2 } from "lucide-react"
import { formatSats } from "@/lib/data"
import { useApp } from "@/lib/app-context"
import {
  addressWatchError,
  canonicalBitcoinAddress,
  fetchAddressConfirmedSats,
} from "@/lib/esplora-address"
import { useWalletWatches } from "@/lib/use-wallet-watch"
import { patchWalletWatch, writeWalletWatches, type WalletWatch } from "@/lib/wallet-watch-store"

type AddressRole = "wallet" | "exchange"

/**
 * Watch individual bitcoin addresses from the browser.
 * Change outputs are not discovered. No seed field.
 */
export function RunwayAddressWatch() {
  const { currentUserId } = useApp()
  const watches = useWalletWatches(currentUserId)
  const addresses = watches.filter((watch) => watch.kind === "address")
  const [address, setAddress] = useState("")
  const [role, setRole] = useState<AddressRole>("wallet")
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const busyRef = useRef(false)

  async function refreshOne(watch: WalletWatch) {
    const sats = await fetchAddressConfirmedSats(watch.descriptor)
    patchWalletWatch(currentUserId, watch.id, {
      confirmedSats: sats,
      updatedAt: new Date().toISOString(),
    })
  }

  async function onAdd() {
    if (busyRef.current || !currentUserId) return
    const problem = addressWatchError(address)
    if (problem) {
      setError(problem)
      return
    }
    const descriptor = canonicalBitcoinAddress(address)
    if (addresses.some((watch) => canonicalBitcoinAddress(watch.descriptor) === descriptor)) {
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
    writeWalletWatches(currentUserId, [...watches, next])
    setAddress("")
    setError(null)
    busyRef.current = true
    setBusyId(next.id)
    try {
      await refreshOne(next)
    } catch {
      setError("Couldn't look up that address. Try again.")
    } finally {
      busyRef.current = false
      setBusyId(null)
    }
  }

  async function onRefresh(watch: WalletWatch) {
    if (busyRef.current) return
    busyRef.current = true
    setBusyId(watch.id)
    setError(null)
    try {
      await refreshOne(watch)
    } catch {
      setError("Couldn't look up that address. Try again.")
    } finally {
      busyRef.current = false
      setBusyId(null)
    }
  }

  function onRemove(id: string) {
    writeWalletWatches(
      currentUserId,
      watches.filter((watch) => watch.id !== id),
    )
  }

  return (
    <div className="flex flex-col gap-3 border-t border-[#1F1F1F] pt-3">
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">Addresses you watch</p>
        <p className="text-xs text-muted-foreground mt-1">
          Watching one address misses change. Wallets send leftover bitcoin to a new address, so
          one address can show too little. Add each address you want counted. The lookup runs in
          your browser and asks a public block explorer (mempool.space). BitBudget never receives
          the address. The explorer can see your IP address together with the address you look up.
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
                  <span className="text-muted-foreground"> · {formatSats(watch.confirmedSats)}</span>
                </p>
                <p className="text-xs text-muted-foreground break-all">{watch.descriptor}</p>
              </div>
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  onClick={() => void onRefresh(watch)}
                  disabled={busyId !== null}
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
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault()
                void onAdd()
              }
            }}
            placeholder="Bitcoin address"
            autoComplete="off"
            spellCheck={false}
            aria-label="Bitcoin address"
            className="min-w-0 w-full rounded-lg border border-[#333] bg-[#1A1A1A] px-3 py-2 text-sm text-foreground"
          />
          <button
            type="button"
            onClick={() => void onAdd()}
            disabled={busyId !== null}
            className="w-full shrink-0 rounded-lg bg-[#F7931A] px-4 py-2 text-sm font-semibold text-[#0D0D0D] hover:bg-[#F7931A]/90 disabled:opacity-50 sm:w-auto"
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
