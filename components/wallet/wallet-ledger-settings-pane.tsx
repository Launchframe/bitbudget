"use client"

import { useState } from "react"
import type { Envelope } from "@/lib/data"
import type { CustodyLedgerSettings } from "@/lib/wallet/ledger-settings"
import { isAllowedExplorerBase } from "@/lib/wallets/xpub-store"
import type { WalletReceiveMode } from "@/lib/wallets/xpub-store"
import { EnvelopeSelect, ReceiveModeField } from "@/components/wallet/ledger-routing-fields"

/**
 * "Budget" tab: how this wallet's activity is recorded, plus the explorer used
 * to read the chain. Mirrors the xpub tracking card so both tiers feel the same.
 */
export function WalletLedgerSettingsPane({
  settings,
  envelopes,
  onSave,
  name,
  onRename,
}: {
  settings: CustodyLedgerSettings
  envelopes: readonly Envelope[]
  onSave: (patch: Partial<CustodyLedgerSettings>) => Promise<CustodyLedgerSettings>
  name: string
  onRename?: (name: string) => Promise<void>
}) {
  const [envelopeId, setEnvelopeId] = useState(settings.defaultEnvelopeId ?? "")
  const [receiveMode, setReceiveMode] = useState<WalletReceiveMode>(settings.receiveMode)
  const [explorer, setExplorer] = useState(settings.explorerBaseUrl)
  const [gapLimit, setGapLimit] = useState(String(settings.gapLimit))
  const [nickname, setNickname] = useState(name)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null)

  const envelopeName = envelopes.find((e) => e.id === envelopeId)?.name

  const save = async () => {
    setMessage(null)
    if (!envelopeId) { setMessage({ kind: "error", text: "Choose an envelope for spending from this wallet." }); return }
    const explorerCheck = isAllowedExplorerBase(explorer)
    if (!explorerCheck.ok) { setMessage({ kind: "error", text: explorerCheck.reason }); return }
    const gap = Number(gapLimit)
    if (!Number.isInteger(gap) || gap < 1 || gap > 200) { setMessage({ kind: "error", text: "Scan depth must be a whole number between 1 and 200." }); return }
    setBusy(true)
    try {
      await onSave({ defaultEnvelopeId: envelopeId, receiveMode, explorerBaseUrl: explorer, gapLimit: gap })
      if (onRename && nickname.trim() && nickname.trim() !== name) await onRename(nickname.trim())
      setMessage({ kind: "ok", text: "Saved." })
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof Error ? err.message : "Could not save." })
    } finally { setBusy(false) }
  }

  return (
    <section className="grid gap-4 lg:grid-cols-2" aria-label="Wallet budget settings">
      <form className="rounded-2xl border border-border bg-[#0D0D0D] p-4 sm:p-6" onSubmit={(e) => { e.preventDefault(); void save() }}>
        <h3 className="font-semibold">Where this wallet&apos;s money shows up</h3>
        <p className="mt-1 text-sm text-muted-foreground">Sends come out of one envelope. Receives can grow Savings or stay in that envelope.</p>
        <div className="mt-4 grid gap-4">
          <div className="grid gap-1.5">
            <label htmlFor="custody-envelope" className="text-sm font-medium">Spending envelope</label>
            <EnvelopeSelect id="custody-envelope" value={envelopeId} onChange={setEnvelopeId} envelopes={envelopes} />
          </div>
          <ReceiveModeField idPrefix="custody" value={receiveMode} onChange={setReceiveMode} envelopeName={envelopeName} />
          {onRename ? (
            <div className="grid gap-1.5">
              <label htmlFor="custody-name" className="text-sm font-medium">Wallet name</label>
              <input id="custody-name" value={nickname} onChange={(e) => setNickname(e.target.value)} maxLength={64} className="h-10 rounded-md border border-[#333] bg-[#1A1A1A] px-3 text-sm" />
              <p className="text-xs text-muted-foreground">Stored encrypted on this device only.</p>
            </div>
          ) : null}
        </div>
        {message ? <p role={message.kind === "error" ? "alert" : "status"} className={`mt-4 text-sm ${message.kind === "error" ? "text-red-300" : "text-green-400"}`}>{message.text}</p> : null}
        <button type="submit" disabled={busy} className="mt-4 w-full rounded-xl bg-[#F7931A] px-4 py-2.5 text-sm font-semibold text-black disabled:opacity-50 sm:w-auto">{busy ? "Saving…" : "Save"}</button>
      </form>

      <div className="rounded-2xl border border-border bg-[#0D0D0D] p-4 sm:p-6">
        <h3 className="font-semibold">Reading the chain</h3>
        <p className="mt-1 text-sm text-muted-foreground">Balances and history come from the explorer you choose. It sees your addresses, so a self-hosted one is the most private.</p>
        <div className="mt-4 grid gap-4">
          <div className="grid gap-1.5">
            <label htmlFor="custody-explorer" className="text-sm font-medium">Explorer URL</label>
            <input id="custody-explorer" value={explorer} onChange={(e) => setExplorer(e.target.value)} inputMode="url" className="h-10 rounded-md border border-[#333] bg-[#1A1A1A] px-3 text-sm" />
            <p className="text-xs text-muted-foreground">Any mempool.space or Esplora-compatible server. Signet and testnet4 need a matching explorer.</p>
          </div>
          <div className="grid gap-1.5">
            <label htmlFor="custody-gap" className="text-sm font-medium">Scan depth</label>
            <input id="custody-gap" value={gapLimit} onChange={(e) => setGapLimit(e.target.value)} inputMode="numeric" className="h-10 w-32 rounded-md border border-[#333] bg-[#1A1A1A] px-3 text-sm" />
            <p className="text-xs text-muted-foreground">How many unused addresses to check past the last one you used. 20 is right for almost everyone.</p>
          </div>
        </div>
        <p className="mt-4 text-xs text-muted-foreground">Changing the explorer does not move funds, rotate keys, or create a new backup.</p>
      </div>
    </section>
  )
}
