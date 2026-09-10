"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { AlertTriangle, ArrowRight, Send } from "lucide-react"
import { useApp } from "@/lib/app-context"
import { useBtcPrices } from "@/lib/btc-price-context"
import { formatSatsInteger, formatUsdPrecise } from "@/lib/data"
import { EsploraClient } from "@/lib/wallets/esplora-client"
import type { StoredWalletCustody } from "@/lib/wallet/wallet-idb"
import { openWalletCustodyStore } from "@/lib/wallet/wallet-idb"
import type { CustodyBalance } from "@/lib/wallet/custody-sync"
import type { CustodyLedgerSettings } from "@/lib/wallet/ledger-settings"
import { deriveCustodyAddresses } from "@/lib/wallet/watch-source"
import { SpendPlanError, chooseFeeRate, planSpend, type SpendPlan } from "@/lib/wallet/spend-builder"
import type { SpendStage } from "@/lib/wallet/spend-session"
import { cacheWalletAssets } from "@/lib/wallet-asset-cache"
import { SigningPipeline, type SigningStep } from "@/components/wallet/signing-pipeline"
import type { WorkspaceWallet } from "@/components/wallet/wallet-workspace"

const planErrorCopy: Record<SpendPlanError["code"], string> = {
  "invalid-address": "That doesn't look like a bitcoin address.",
  "wrong-network": "That address is for a different network than this wallet.",
  "amount-too-small": "Amount is too small to send on-chain.",
  "insufficient-funds": "Not enough confirmed bitcoin in this wallet for that amount plus the network fee.",
  "fee-rate-out-of-range": "Fee rate must be between 1 and 2000 sat/vB.",
  "fee-too-high": "The network fee would be unreasonably high for this amount.",
  "no-coins": "No confirmed bitcoin to spend yet.",
  "invalid-change": "Could not prepare a change address. Try syncing again.",
}

const clientErrorCopy: Record<string, string> = {
  "setup-cancelled": "Approval was cancelled.",
  "credential-rejected": "This device's passkey does not match the wallet. Use the device you created it on, or recover first.",
  "device-share-unavailable": "This device does not hold a wallet share. Recover the wallet here before sending.",
  "grant-rejected": "Approval expired or was already used. Try again.",
  "tier-required": "Sending is part of Premium and the free trial.",
  "passkey-encryption-unavailable": "Your passkey did not return the data needed to unlock the wallet share.",
  "spent-output-mismatch": "The co-signer could not confirm these coins belong to this wallet. Sync and try again.",
  "cosigner-unavailable": "The co-signer is temporarily unavailable. Your funds are safe; try again shortly.",
  "wallet-service-unavailable": "Wallet service is unavailable right now.",
}

const evidenceErrorCopy: Record<string, string> = {
  "indexer-unavailable": "Could not reach your explorer to double-check these coins. Nothing was sent.",
  "input-spent": "One of these coins was already spent. Sync and prepare the send again.",
  "input-missing": "Your explorer does not know one of these coins. Sync and prepare the send again.",
  "amount-mismatch": "Your explorer reports a different amount for one of these coins. Sync and prepare the send again.",
  "script-mismatch": "One of these coins is not paid to this wallet. Sync and prepare the send again.",
  "unconfirmed-input": "One of these coins is still unconfirmed. Wait for a confirmation and try again.",
  "evidence-stale": "The chain moved while you were approving. Prepare the send again.",
}

function stageToStep(stage: SpendStage | null): SigningStep | null {
  switch (stage) {
    case null:
      return null
    case "preparing":
    case "approving":
      return "auth"
    case "cosigning":
    case "finalizing":
      return "computing"
    case "broadcasting":
      return "broadcasting"
    case "done":
      return "done"
    default: {
      const exhaustive: never = stage
      return exhaustive
    }
  }
}

export function WalletSendPane({
  userId,
  wallet,
  record,
  balance,
  settings,
  name,
  onSent,
}: {
  userId: string
  wallet: WorkspaceWallet
  record: StoredWalletCustody | null
  balance: CustodyBalance | null
  settings: CustodyLedgerSettings
  name: string
  onSent: () => void
}) {
  const { getPrivacyKey } = useApp()
  const { currentPrice } = useBtcPrices()
  const [recipient, setRecipient] = useState("")
  const [amount, setAmount] = useState("")
  const [sendMax, setSendMax] = useState(false)
  const [feeRate, setFeeRate] = useState<number | null>(null)
  const [plan, setPlan] = useState<SpendPlan | null>(null)
  const [planError, setPlanError] = useState<string | null>(null)
  const [stage, setStage] = useState<SpendStage | null>(null)
  const [sendError, setSendError] = useState<string | null>(null)
  const [result, setResult] = useState<{ txid: string } | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])

  const spendable = balance?.confirmedSats ?? 0
  const canSign = wallet.status === "ready" && Boolean(record?.envelopes.deviceShare) && wallet.network !== "mainnet"
  const isTestNetwork = wallet.network === "signet" || wallet.network === "testnet4" || wallet.network === "regtest"

  // Fee estimate from the user's explorer (best effort).
  useEffect(() => {
    let cancelled = false
    const client = new EsploraClient({ baseUrl: settings.explorerBaseUrl })
    void client.getFeeEstimates().then((est) => { if (!cancelled) setFeeRate(chooseFeeRate(est)) }).catch(() => { if (!cancelled) setFeeRate(chooseFeeRate({})) })
    return () => { cancelled = true }
  }, [settings.explorerBaseUrl])

  const amountSats = useMemo(() => {
    const n = Number(amount.replace(/[,\s]/g, ""))
    return Number.isInteger(n) && n >= 0 ? n : NaN
  }, [amount])

  const preview = useCallback(async () => {
    setPlanError(null)
    setPlan(null)
    setSendError(null)
    setResult(null)
    if (!record || !balance || feeRate == null) return
    if (!sendMax && !Number.isFinite(amountSats)) { setPlanError("Enter a whole number of sats."); return }
    const key = getPrivacyKey()
    if (!key) { setPlanError("Unlock your privacy key to prepare a send."); return }
    try {
      // Peek at the next change index without reserving it; reservation happens on confirm.
      const [change] = await deriveCustodyAddresses({ record, privacyKey: key, branch: "change", startIndex: record.nextChangeIndex, count: 1 })
      const next = planSpend({
        utxos: balance.utxos,
        recipientAddress: recipient,
        amountSats: sendMax ? 0 : amountSats,
        feeRateSatVb: feeRate,
        changeAddress: change!.address,
        changeIndex: change!.index,
        network: wallet.network,
        sendMax,
      })
      setPlan(next)
      setConfirmOpen(true)
    } catch (err) {
      if (err instanceof SpendPlanError) setPlanError(planErrorCopy[err.code])
      else setPlanError(err instanceof Error ? err.message : "Could not prepare this send.")
    } finally { key.fill(0) }
  }, [record, balance, feeRate, sendMax, amountSats, getPrivacyKey, recipient, wallet.network])

  const confirm = useCallback(async () => {
    if (!record || !plan || !isTestNetwork) return
    setSendError(null)
    setStage("preparing")
    const key = getPrivacyKey()
    if (!key) { setSendError("Unlock your privacy key to send."); setStage(null); return }
    let store: Awaited<ReturnType<typeof openWalletCustodyStore>> | undefined
    try {
      // Reserve the change index now so it is never handed out as a receive address.
      if (plan.changeSats > 0) {
        store = await openWalletCustodyStore(userId)
        const reservation = await store.reserveAddressIndices(record.identity.id, "change", 1)
        if (reservation.startIndex !== plan.changeIndex) {
          throw new Error("Change address changed underneath this send. Prepare it again.")
        }
      }
      await cacheWalletAssets("signer", { enabled: true, reason: "demand" })
      const { executeSpend } = await import("@/lib/wallet/spend-session")
      const client = new EsploraClient({ baseUrl: settings.explorerBaseUrl })
      const done = await executeSpend({
        userId,
        walletId: wallet.id,
        network: wallet.network as "signet" | "testnet4" | "regtest",
        record,
        privacyKey: key,
        plan,
        lineage: "sha256d",
        client,
        onStage: (s) => { if (alive.current) setStage(s) },
      })
      if (!alive.current) return
      setResult({ txid: done.txid })
      setConfirmOpen(false)
      setRecipient("")
      setAmount("")
      setPlan(null)
      onSent()
    } catch (err) {
      if (!alive.current) return
      const code = err instanceof Error ? err.message : ""
      const evidenceCode = err instanceof Error && err.name === "SpendEvidenceError" ? code.split(":")[0]! : ""
      setSendError(evidenceErrorCopy[evidenceCode] ?? clientErrorCopy[code] ?? (err instanceof Error && err.message ? err.message : "Sending failed. Nothing was broadcast."))
      setStage(null)
    } finally {
      key.fill(0)
      store?.close()
    }
  }, [record, plan, isTestNetwork, getPrivacyKey, userId, settings.explorerBaseUrl, wallet.id, wallet.network, onSent])

  const usd = (sats: number) => currentPrice != null && currentPrice > 0 ? formatUsdPrecise((sats / 1e8) * currentPrice) : null

  if (!canSign) {
    return (
      <section className="rounded-2xl border border-border bg-[#0D0D0D] p-4 sm:p-6" aria-label="Send bitcoin">
        <h3 className="font-semibold">Send</h3>
        <p className="mt-2 text-sm text-muted-foreground">
          {wallet.status !== "ready" ? "Finish setup and verify your recovery file before sending." : !record?.envelopes.deviceShare ? "This device does not hold a wallet share. Open the wallet on the device you created it on, or recover it here first." : "Sending on mainnet is not enabled yet."}
        </p>
      </section>
    )
  }

  return (
    <section className="grid gap-4 lg:grid-cols-2" aria-label="Send bitcoin">
      <form className="rounded-2xl border border-border bg-[#0D0D0D] p-4 sm:p-6" onSubmit={(e) => { e.preventDefault(); void preview() }}>
        <h3 className="font-semibold">Send bitcoin</h3>
        <p className="mt-1 text-sm text-muted-foreground">Spendable now: <span className="font-mono text-foreground">{formatSatsInteger(spendable)} sats</span>{usd(spendable) ? ` (≈ ${usd(spendable)})` : ""}</p>
        <div className="mt-4 grid gap-4">
          <div className="grid gap-1.5">
            <label htmlFor="send-to" className="text-sm font-medium">To</label>
            <input id="send-to" value={recipient} onChange={(e) => setRecipient(e.target.value)} autoComplete="off" spellCheck={false} placeholder={wallet.network === "regtest" ? "bcrt1…" : "tb1…"} className="h-10 rounded-md border border-[#333] bg-[#1A1A1A] px-3 font-mono text-sm" />
          </div>
          <div className="grid gap-1.5">
            <div className="flex items-center justify-between">
              <label htmlFor="send-amount" className="text-sm font-medium">Amount (sats)</label>
              <button type="button" onClick={() => setSendMax((v) => !v)} aria-pressed={sendMax} className={`text-xs font-semibold ${sendMax ? "text-[#F7931A]" : "text-muted-foreground"}`}>Send everything</button>
            </div>
            <input id="send-amount" value={sendMax ? "" : amount} disabled={sendMax} onChange={(e) => setAmount(e.target.value)} inputMode="numeric" placeholder={sendMax ? "Whole balance minus fee" : "0"} className="h-10 rounded-md border border-[#333] bg-[#1A1A1A] px-3 font-mono text-sm disabled:opacity-60" />
            {!sendMax && Number.isFinite(amountSats) && amountSats > 0 && usd(amountSats) ? <p className="text-xs text-muted-foreground">≈ {usd(amountSats)}</p> : null}
          </div>
          <p className="text-xs text-muted-foreground">Network fee: {feeRate == null ? "estimating…" : `${feeRate} sat/vB, from your explorer`}. Fees go to miners, not BitBudget.</p>
        </div>
        {planError ? <p role="alert" className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{planError}</p> : null}
        <button type="submit" disabled={!recipient || (!sendMax && !amount) || feeRate == null || !balance} className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#F7931A] px-4 py-2.5 text-sm font-semibold text-black disabled:opacity-50 sm:w-auto">Review <ArrowRight className="h-4 w-4" aria-hidden /></button>
      </form>

      <div className="rounded-2xl border border-border bg-[#0D0D0D] p-4 sm:p-6">
        {result ? (
          <div>
            <h3 className="font-semibold text-green-400">Sent</h3>
            <p className="mt-2 text-sm text-muted-foreground">Your transaction is on its way. It will show up in your budget once it confirms and you sync.</p>
            <code className="mt-3 block break-all rounded-xl border border-border bg-[#1A1A1A] p-3 font-mono text-xs">{result.txid}</code>
            <a href={`${settings.explorerBaseUrl.replace(/\/+$/, "")}/tx/${result.txid}`} target="_blank" rel="noreferrer noopener" className="mt-3 inline-block text-sm font-semibold text-[#F7931A]">View on your explorer →</a>
          </div>
        ) : confirmOpen && plan ? (
          <div>
            <h3 className="font-semibold">Review and approve</h3>
            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex justify-between gap-3"><dt className="text-muted-foreground">To</dt><dd className="min-w-0 truncate font-mono text-xs">{plan.outputs[0]!.address}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Amount</dt><dd className="font-mono">{formatSatsInteger(plan.outputs[0]!.valueSats)} sats{usd(plan.outputs[0]!.valueSats) ? <span className="ml-2 text-xs text-muted-foreground">≈ {usd(plan.outputs[0]!.valueSats)}</span> : null}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Network fee</dt><dd className="font-mono">{formatSatsInteger(plan.feeSats)} sats <span className="text-xs text-muted-foreground">({plan.feeRateSatVb} sat/vB · {plan.vbytes} vB)</span></dd></div>
              {plan.changeSats > 0 ? <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Back to this wallet</dt><dd className="flex items-center gap-2 font-mono">{formatSatsInteger(plan.changeSats)} sats <span className="rounded-full border border-[#F7931A]/40 bg-[#F7931A]/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#F7931A]">Change</span></dd></div> : null}
              {plan.absorbedDustSats > 0 ? <p className="text-xs text-muted-foreground">{formatSatsInteger(plan.absorbedDustSats)} sats of leftover was too small to keep and was added to the fee.</p> : null}
              <div className="flex justify-between gap-3 border-t border-border pt-2"><dt className="text-muted-foreground">Coins used</dt><dd>{plan.inputs.length}</dd></div>
            </dl>
            <p className="mt-4 flex items-start gap-2 text-xs text-muted-foreground"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-200" aria-hidden />You will approve with your passkey. BitBudget&apos;s co-signer adds its share and this browser broadcasts. Bitcoin sends cannot be undone.</p>
            {stage ? <SigningPipeline currentStep={stageToStep(stage)} error={sendError} className="mt-4" /> : sendError ? <p role="alert" className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{sendError}</p> : null}
            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <button type="button" disabled={Boolean(stage)} onClick={() => void confirm()} className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#F7931A] px-4 py-2.5 text-sm font-semibold text-black disabled:opacity-50"><Send className="h-4 w-4" aria-hidden />{stage ? "Sending…" : "Approve and send"}</button>
              <button type="button" disabled={Boolean(stage)} onClick={() => { setConfirmOpen(false); setPlan(null); setSendError(null) }} className="rounded-xl border border-border px-4 py-2.5 text-sm disabled:opacity-50">Back</button>
            </div>
          </div>
        ) : (
          <div>
            <h3 className="font-semibold">How sending works</h3>
            <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
              <li>You enter where and how much. We pick which coins to use and estimate the fee from your explorer.</li>
              <li>You approve with your passkey. That unlocks this device&apos;s share for exactly this transaction.</li>
              <li>BitBudget&apos;s co-signer adds its share. It sees the transaction, not your balance or other coins.</li>
              <li>This browser assembles the final signature and broadcasts to the network through your explorer.</li>
            </ol>
            <p className="mt-4 text-xs text-muted-foreground">Once it confirms and you sync, the send appears in <span className="text-foreground">{name}</span>&apos;s budget envelope as a normal expense.</p>
          </div>
        )}
      </div>
    </section>
  )
}
