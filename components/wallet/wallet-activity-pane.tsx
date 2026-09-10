"use client"

import { useEffect, useMemo, useState } from "react"
import { ArrowDownToLine, ArrowUpFromLine, ExternalLink } from "lucide-react"
import { useApp } from "@/lib/app-context"
import { formatSatsInteger, formatUsdPrecise, type Transaction } from "@/lib/data"
import { getImportedTxidsForWallet } from "@/lib/wallets/xpub-cache"
import { custodyWatchId } from "@/lib/wallet/watch-source"
import type { CustodyBalance } from "@/lib/wallet/custody-sync"

/**
 * Activity tab: the budget rows this wallet produced, joined through the local
 * txid → transaction id cache so rows from other wallets or manual entries are
 * never mixed in. Unspent outputs are listed below for transparency.
 */
export function WalletActivityPane({ userId, walletId, balance, explorerBaseUrl }: { userId: string; walletId: string; balance: CustodyBalance | null; explorerBaseUrl: string }) {
  const { activeTransactions, state } = useApp()
  const [txnIds, setTxnIds] = useState<Map<string, string> | null>(null)

  useEffect(() => {
    let cancelled = false
    void getImportedTxidsForWallet(userId, custodyWatchId(walletId)).then((rows) => {
      if (cancelled) return
      const map = new Map<string, string>()
      for (const row of rows) if (row.bitbudgetTxnId) map.set(row.bitbudgetTxnId, row.txid)
      setTxnIds(map)
    }).catch(() => { if (!cancelled) setTxnIds(new Map()) })
    return () => { cancelled = true }
  }, [userId, walletId, balance?.fetchedAt])

  const rows = useMemo(() => {
    if (!txnIds) return []
    return activeTransactions
      .filter((t) => t.source === "onchain_wallet" && txnIds.has(t.id))
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
  }, [activeTransactions, txnIds])

  const envelopeName = (id: string) => state.envelopes.find((e) => e.id === id)?.name ?? "—"
  const txUrl = (txid: string) => `${explorerBaseUrl.replace(/\/+$/, "")}/tx/${txid}`

  return (
    <section className="grid gap-4" aria-label="Wallet activity">
      <div className="rounded-2xl border border-border bg-[#0D0D0D] p-4 sm:p-6">
        <h3 className="font-semibold">In your budget</h3>
        <p className="mt-1 text-sm text-muted-foreground">Every confirmed send or receive is a normal budget transaction. Edit notes, tags, or the envelope from Transactions like anything else.</p>
        {txnIds === null ? <p role="status" className="mt-4 text-sm text-muted-foreground">Loading…</p> : rows.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">No wallet activity in your budget yet. Sync after your first payment confirms.</p>
        ) : (
          <ul className="mt-4 divide-y divide-border">
            {rows.map((t: Transaction) => (
              <li key={t.id} className="flex min-w-0 items-center gap-3 py-3">
                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${t.type === "credit" ? "bg-[#22C55E]/10 text-[#22C55E]" : "bg-[#F7931A]/10 text-[#F7931A]"}`}>
                  {t.type === "credit" ? <ArrowDownToLine className="h-4 w-4" aria-hidden /> : <ArrowUpFromLine className="h-4 w-4" aria-hidden />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{t.type === "credit" ? "Received" : "Sent"} · {envelopeName(t.envelopeId)}</p>
                  <p className="text-xs text-muted-foreground">{t.date.slice(0, 10)}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-mono text-sm">{t.type === "credit" ? "+" : "−"}{formatSatsInteger(t.satsAmount ?? 0)} sats</p>
                  <p className="text-xs text-muted-foreground">{formatUsdPrecise(t.amount)}</p>
                </div>
                {txnIds.get(t.id) ? <a href={txUrl(txnIds.get(t.id)!)} target="_blank" rel="noreferrer noopener" aria-label="View on your explorer" className="shrink-0 text-muted-foreground hover:text-foreground"><ExternalLink className="h-4 w-4" aria-hidden /></a> : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-2xl border border-border bg-[#0D0D0D] p-4 sm:p-6">
        <h3 className="font-semibold">Coins in this wallet</h3>
        <p className="mt-1 text-sm text-muted-foreground">Individual unspent amounts. Change from your own sends is labeled so you can tell it apart from money you received.</p>
        {!balance ? <p className="mt-4 text-sm text-muted-foreground">Sync to load coins.</p> : balance.utxos.length === 0 ? <p className="mt-4 text-sm text-muted-foreground">No coins yet.</p> : (
          <ul className="mt-4 space-y-2">
            {balance.utxos.map((u) => (
              <li key={`${u.txid}:${u.vout}`} className="flex min-w-0 items-center justify-between gap-3 rounded-xl border border-border bg-[#1A1A1A] p-3 text-xs">
                <span className="min-w-0 truncate font-mono">{u.address}</span>
                <span className="flex shrink-0 items-center gap-2">
                  {u.chain === 1 ? <span className="rounded-full border border-[#F7931A]/40 bg-[#F7931A]/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#F7931A]">Change</span> : null}
                  {!u.confirmed ? <span className="rounded-full border border-amber-500/40 px-2 py-0.5 text-[10px] uppercase tracking-wide text-amber-200">Pending</span> : null}
                  <span className="font-mono">{formatSatsInteger(u.valueSats)} sats</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
