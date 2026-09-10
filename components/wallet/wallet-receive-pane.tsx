"use client"

import { useCallback, useEffect, useState } from "react"
import { QRCodeSVG } from "qrcode.react"
import { Check, Copy, Plus } from "lucide-react"
import { useApp } from "@/lib/app-context"
import { openWalletCustodyStore, type StoredWalletCustody } from "@/lib/wallet/wallet-idb"
import { deriveCustodyAddresses, type CustodyAddress } from "@/lib/wallet/watch-source"
import type { CustodyBalance } from "@/lib/wallet/custody-sync"
import { formatSatsInteger } from "@/lib/data"

/**
 * Receive tab. Each "New address" click reserves the next receive index in the
 * device-local custody record (monotonic, never reused) and derives the address
 * from the sealed watch seed. Change addresses are system-labeled so users do
 * not hand them out.
 */
export function WalletReceivePane({ userId, record, balance }: { userId: string; record: StoredWalletCustody; balance: CustodyBalance | null }) {
  const { getPrivacyKey } = useApp()
  const [current, setCurrent] = useState<CustodyAddress | null>(null)
  const [recent, setRecent] = useState<CustodyAddress[]>([])
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const [nextIndex, setNextIndex] = useState(record.nextReceiveIndex)

  const load = useCallback(async (fromIndex: number) => {
    const key = getPrivacyKey()
    if (!key) { setError("Unlock your privacy key to show addresses."); return }
    try {
      // Show the most recent reserved addresses (up to 5). Index `fromIndex - 1` is the latest.
      const count = Math.min(5, fromIndex)
      if (count === 0) { setRecent([]); setCurrent(null); return }
      const list = await deriveCustodyAddresses({ record, privacyKey: key, branch: "receive", startIndex: fromIndex - count, count })
      list.reverse()
      setRecent(list)
      setCurrent(list[0] ?? null)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not derive an address.")
    } finally { key.fill(0) }
  }, [getPrivacyKey, record])

  useEffect(() => {
    let cancelled = false
    void Promise.resolve().then(() => { if (!cancelled) return load(nextIndex) })
    return () => { cancelled = true }
  }, [load, nextIndex])

  const reserveNew = useCallback(async () => {
    setBusy(true)
    setError(null)
    let store: Awaited<ReturnType<typeof openWalletCustodyStore>> | undefined
    try {
      store = await openWalletCustodyStore(userId)
      const reservation = await store.reserveAddressIndices(record.identity.id, "receive", 1)
      setNextIndex(reservation.nextIndex)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reserve a new address.")
    } finally { store?.close(); setBusy(false) }
  }, [userId, record.identity.id])

  const copy = useCallback(async () => {
    if (!current) return
    try {
      await navigator.clipboard.writeText(current.address)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { setError("Copy failed. Select the address and copy it manually.") }
  }, [current])

  const receivedOn = (address: string) => balance?.utxos.filter((u) => u.address === address).reduce((s, u) => s + u.valueSats, 0) ?? 0

  return (
    <section className="grid gap-4 lg:grid-cols-2" aria-label="Receive bitcoin">
      <div className="rounded-2xl border border-border bg-[#0D0D0D] p-4 sm:p-6">
        <h3 className="font-semibold">Your receive address</h3>
        <p className="mt-1 text-sm text-muted-foreground">Share this with whoever is paying you. Each address is used once; tap New address after it receives.</p>
        {error ? <p role="alert" className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{error}</p> : null}
        {current ? (
          <div className="mt-4 flex flex-col items-center gap-4">
            <div className="rounded-2xl bg-white p-3"><QRCodeSVG value={`bitcoin:${current.address}`} size={168} aria-label="Receive address QR code" /></div>
            <code className="w-full break-all rounded-xl border border-border bg-[#1A1A1A] p-3 text-center font-mono text-xs sm:text-sm">{current.address}</code>
            <div className="flex w-full flex-col gap-2 sm:flex-row">
              <button type="button" onClick={() => void copy()} className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#F7931A] px-4 py-2.5 text-sm font-semibold text-black">{copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}{copied ? "Copied" : "Copy address"}</button>
              <button type="button" disabled={busy} onClick={() => void reserveNew()} className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm disabled:opacity-50"><Plus className="h-4 w-4" aria-hidden />New address</button>
            </div>
            <p className="text-xs text-muted-foreground">Address #{current.index + 1} · Taproot</p>
          </div>
        ) : !error ? (
          <button type="button" disabled={busy} onClick={() => void reserveNew()} className="mt-4 inline-flex items-center justify-center gap-2 rounded-xl bg-[#F7931A] px-4 py-2.5 text-sm font-semibold text-black disabled:opacity-50"><Plus className="h-4 w-4" aria-hidden />Get your first address</button>
        ) : null}
      </div>

      <div className="rounded-2xl border border-border bg-[#0D0D0D] p-4 sm:p-6">
        <h3 className="font-semibold">Recent addresses</h3>
        <p className="mt-1 text-sm text-muted-foreground">Addresses you have handed out. Change addresses (used internally when you send) are labeled and should not be shared.</p>
        <ul className="mt-4 space-y-2">
          {recent.map((a) => (
            <li key={a.address} className="flex min-w-0 items-center justify-between gap-3 rounded-xl border border-border bg-[#1A1A1A] p-3 text-xs">
              <span className="min-w-0 truncate font-mono">{a.address}</span>
              <span className="shrink-0 text-muted-foreground">{receivedOn(a.address) > 0 ? `${formatSatsInteger(receivedOn(a.address))} sats` : "unused"}</span>
            </li>
          ))}
          {balance?.utxos.filter((u) => u.chain === 1).slice(0, 3).map((u) => (
            <li key={`${u.txid}:${u.vout}`} className="flex min-w-0 items-center justify-between gap-3 rounded-xl border border-border bg-[#1A1A1A] p-3 text-xs">
              <span className="min-w-0 truncate font-mono">{u.address}</span>
              <span className="flex shrink-0 items-center gap-2"><span className="rounded-full border border-[#F7931A]/40 bg-[#F7931A]/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#F7931A]">Change</span><span className="text-muted-foreground">{formatSatsInteger(u.valueSats)} sats</span></span>
            </li>
          ))}
          {recent.length === 0 && !balance?.utxos.length ? <li className="text-sm text-muted-foreground">No addresses yet.</li> : null}
        </ul>
      </div>
    </section>
  )
}
