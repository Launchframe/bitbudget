"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ArrowLeft, LayoutDashboard, List, QrCode, RefreshCw, Send, Settings2, Shield } from "lucide-react"
import { useApp } from "@/lib/app-context"
import { useBtcPrices } from "@/lib/btc-price-context"
import { findSavingsEnvelope } from "@/lib/savings-ui-metrics"
import { formatBtcAmountFromSats, formatUsdPrecise } from "@/lib/data"
import { decryptField } from "@/lib/crypto"
import { openWalletCustodyStore, type StoredWalletCustody } from "@/lib/wallet/wallet-idb"
import { defaultLedgerSettings, loadLedgerSettings, saveLedgerSettings, type CustodyLedgerSettings } from "@/lib/wallet/ledger-settings"
import { fetchCustodyBalance, syncCustodyWallet, type CustodyBalance } from "@/lib/wallet/custody-sync"
import { EsploraClient } from "@/lib/wallets/esplora-client"
import type { SyncProgress } from "@/lib/wallets/xpub-sync"
import type { BitcoinNetwork } from "@/lib/wallet/types"
import { describeLedgerRouting } from "@/components/wallet/ledger-routing-fields"
import { WalletReceivePane } from "@/components/wallet/wallet-receive-pane"
import { WalletActivityPane } from "@/components/wallet/wallet-activity-pane"
import { WalletLedgerSettingsPane } from "@/components/wallet/wallet-ledger-settings-pane"
import { WalletSecurityPane } from "@/components/wallet/wallet-security-pane"
import { WalletSendPane } from "@/components/wallet/wallet-send-pane"

export type WorkspaceTab = "overview" | "receive" | "send" | "activity" | "settings" | "security"

export interface WorkspaceWallet {
  id: string
  network: BitcoinNetwork
  status: string
  signingAvailable: boolean
  recoveryVerifiedAt?: string | null
}

const TABS: { id: WorkspaceTab; label: string; Icon: React.ElementType }[] = [
  { id: "overview", label: "Overview", Icon: LayoutDashboard },
  { id: "receive", label: "Receive", Icon: QrCode },
  { id: "send", label: "Send", Icon: Send },
  { id: "activity", label: "Activity", Icon: List },
  { id: "settings", label: "Budget", Icon: Settings2 },
  { id: "security", label: "Security", Icon: Shield },
]

export interface SyncUiState {
  status: "idle" | "running" | "ok" | "error"
  progress?: SyncProgress
  imported?: number
  error?: string
}

export default function WalletWorkspace({
  userId,
  wallet,
  name,
  onBack,
  onRenamed,
}: {
  userId: string
  wallet: WorkspaceWallet
  name: string
  onBack: () => void
  onRenamed?: (name: string) => void
}) {
  const { state, getPrivacyKey, addTransaction, discretionaryEnvelopes } = useApp()
  const { getPriceOnDate, currentPrice } = useBtcPrices()
  const [tab, setTab] = useState<WorkspaceTab>("overview")
  const [record, setRecord] = useState<StoredWalletCustody | null | undefined>(undefined)
  const [settings, setSettings] = useState<CustodyLedgerSettings>(() => defaultLedgerSettings(wallet.network))
  const [balance, setBalance] = useState<CustodyBalance | null>(null)
  const [sync, setSync] = useState<SyncUiState>({ status: "idle" })
  const [loadError, setLoadError] = useState<string | null>(null)
  const alive = useRef(true)
  const savingsEnvelopeId = findSavingsEnvelope(state.envelopes)?.id ?? null

  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])

  // Load the device-local custody record and this wallet's budgeting settings.
  useEffect(() => {
    let cancelled = false
    const key = getPrivacyKey()
    if (!key) {
      setLoadError("Unlock your privacy key to open this wallet.")
      setRecord(null)
      return
    }
    let store: Awaited<ReturnType<typeof openWalletCustodyStore>> | undefined
    void (async () => {
      try {
        store = await openWalletCustodyStore(userId)
        const found = await store.getWallet(wallet.id)
        const loaded = await loadLedgerSettings(userId, key, wallet.id, wallet.network)
        if (cancelled) return
        setRecord(found)
        setSettings(loaded)
        setLoadError(found ? null : "This wallet was created on another device. Import your recovery file here to use it.")
      } catch (err) {
        if (!cancelled) { setRecord(null); setLoadError(err instanceof Error ? err.message : "Could not open this wallet.") }
      } finally {
        key.fill(0)
        store?.close()
      }
    })()
    return () => { cancelled = true }
  }, [userId, wallet.id, wallet.network, getPrivacyKey])

  // Cached balance from the last scan, without hitting the explorer for a full sync.
  useEffect(() => {
    if (!record) return
    let cancelled = false
    const client = new EsploraClient({ baseUrl: settings.explorerBaseUrl })
    void fetchCustodyBalance({ userId, walletId: wallet.id, client })
      .then((b) => { if (!cancelled) setBalance(b) })
      .catch(() => { /* balance is best-effort until the first sync */ })
    return () => { cancelled = true }
  }, [record, userId, wallet.id, settings.explorerBaseUrl])

  const persistSettings = useCallback(async (patch: Partial<CustodyLedgerSettings>) => {
    const key = getPrivacyKey()
    if (!key) throw new Error("Unlock your privacy key to change wallet settings.")
    try {
      const next = await saveLedgerSettings(userId, key, wallet.id, wallet.network, patch)
      if (alive.current) setSettings(next)
      return next
    } finally { key.fill(0) }
  }, [getPrivacyKey, userId, wallet.id, wallet.network])

  const runSyncPass = useCallback(async () => {
    if (!record) return
    const key = getPrivacyKey()
    if (!key) { setSync({ status: "error", error: "Unlock your privacy key to sync." }); return }
    setSync({ status: "running" })
    try {
      const result = await syncCustodyWallet({
        userId,
        privacyKey: key,
        record,
        nickname: name,
        settings,
        savingsEnvelopeId,
        getPriceOnDate,
        saveTransaction: (txn) => addTransaction(txn),
        onProgress: (p) => { if (alive.current) setSync({ status: "running", progress: p }) },
      })
      if (!alive.current) return
      setBalance(result.balance)
      setSync({ status: "ok", imported: result.txsImported })
      await persistSettings({ lastSyncAt: new Date().toISOString() })
    } catch (err) {
      if (alive.current) setSync({ status: "error", error: err instanceof Error ? err.message : "Sync failed." })
    } finally { key.fill(0) }
  }, [record, getPrivacyKey, userId, name, settings, savingsEnvelopeId, getPriceOnDate, addTransaction, persistSettings])

  const rename = useCallback(async (nextName: string) => {
    // Names live encrypted in the custody record; re-read to confirm we can decrypt before echoing.
    const key = getPrivacyKey()
    if (!key) throw new Error("Unlock your privacy key to rename this wallet.")
    try {
      const store = await openWalletCustodyStore(userId)
      try {
        const current = await store.getWallet(wallet.id)
        if (current?.encryptedName) await decryptField(current.encryptedName, key)
      } finally { store.close() }
    } finally { key.fill(0) }
    onRenamed?.(nextName)
  }, [getPrivacyKey, userId, wallet.id, onRenamed])

  const totalSats = balance ? balance.confirmedSats + balance.pendingSats : null
  const routing = useMemo(() => describeLedgerRouting(settings, state.envelopes), [settings, state.envelopes])
  const usdValue = totalSats != null && currentPrice != null && currentPrice > 0 ? (totalSats / 1e8) * currentPrice : null
  const isTestNetwork = wallet.network !== "mainnet"

  return (
    <div className="col-span-full flex min-w-0 flex-col gap-5" data-wallet-feature="workspace">
      <header className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <button type="button" onClick={onBack} aria-label="Back to wallet overview" className="rounded-xl border border-border p-2 text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" aria-hidden /></button>
          <div className="min-w-0">
            <h2 className="truncate text-xl font-semibold">{name}</h2>
            <p className="text-xs text-muted-foreground">{wallet.network} · {wallet.status === "ready" ? "recovery verified" : "setup incomplete"}</p>
          </div>
        </div>
        <button type="button" onClick={() => void runSyncPass()} disabled={!record || sync.status === "running"} className="inline-flex items-center gap-2 rounded-xl border border-[#F7931A] px-4 py-2 text-sm font-semibold text-[#F7931A] disabled:opacity-50">
          <RefreshCw className={`h-4 w-4 ${sync.status === "running" ? "animate-spin" : ""}`} aria-hidden />
          {sync.status === "running" ? "Syncing…" : "Sync"}
        </button>
      </header>

      {isTestNetwork ? <p role="status" className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-sm text-amber-200">This wallet is on {wallet.network}. Coins here have no value; it is for trying the wallet before mainnet is enabled.</p> : null}
      {loadError ? <p role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{loadError}</p> : null}
      {sync.status === "error" ? <p role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{sync.error}</p> : null}
      {sync.status === "running" && sync.progress ? <p role="status" className="text-xs text-muted-foreground">Checked {sync.progress.scannedAddresses} addresses · {sync.progress.txsFound} transactions found</p> : null}
      {sync.status === "ok" ? <p role="status" className="text-xs text-green-400">Synced. {sync.imported ? `${sync.imported} new transaction${sync.imported === 1 ? "" : "s"} added to your budget.` : "Nothing new."}</p> : null}

      <nav aria-label="Wallet sections" className="flex min-w-0 gap-2 overflow-x-auto pb-1">
        {TABS.map(({ id, label, Icon }) => (
          <button key={id} type="button" aria-pressed={tab === id} onClick={() => setTab(id)} className={`inline-flex shrink-0 items-center gap-2 rounded-full border px-4 py-2 text-sm ${tab === id ? "border-[#F7931A] text-[#F7931A]" : "border-border text-muted-foreground"}`}>
            <Icon className="h-4 w-4" aria-hidden />{label}
          </button>
        ))}
      </nav>

      {tab === "overview" ? (
        <section className="grid gap-3 md:grid-cols-3" aria-label="Wallet summary">
          <div className="rounded-2xl border border-[#F7931A]/20 bg-[#0D0D0D] p-4 sm:p-5 md:col-span-2">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Balance</p>
            <p className="mt-2 font-mono text-2xl font-semibold sm:text-3xl">{totalSats == null ? "—" : formatBtcAmountFromSats(totalSats, state.btcDisplayUnit)}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {usdValue == null ? "Sync to see your balance." : `≈ ${formatUsdPrecise(usdValue)} at today's price`}
              {balance && balance.pendingSats > 0 ? ` · ${formatBtcAmountFromSats(balance.pendingSats, state.btcDisplayUnit)} pending` : ""}
            </p>
            <p className="mt-4 text-xs text-muted-foreground">{settings.lastSyncAt ? `Last synced ${new Date(settings.lastSyncAt).toLocaleString()}` : "Never synced on this device"}</p>
          </div>
          <div className="rounded-2xl border border-border bg-[#0D0D0D] p-4 sm:p-5">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">In your budget</p>
            <p className="mt-2 text-sm">{routing}</p>
            {!settings.defaultEnvelopeId ? <button type="button" onClick={() => setTab("settings")} className="mt-3 text-sm font-semibold text-[#F7931A]">Choose an envelope →</button> : null}
            <p className="mt-4 text-xs text-muted-foreground">Amounts are recorded in sats; the dollar value uses the price on the day each transaction confirmed.</p>
          </div>
          <div className="rounded-2xl border border-border bg-[#0D0D0D] p-4 sm:p-5 md:col-span-3">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">How this wallet is protected</p>
            <p className="mt-2 text-sm text-muted-foreground">Spending needs two of three shares: this device (unlocked with your passkey), BitBudget&apos;s co-signer, or your recovery file. No single one can move funds. <button type="button" onClick={() => setTab("security")} className="font-semibold text-[#F7931A]">Learn more about the BitBudget Wallet</button></p>
          </div>
        </section>
      ) : null}

      {tab === "receive" && record ? <WalletReceivePane userId={userId} record={record} balance={balance} /> : tab === "receive" ? <p className="text-sm text-muted-foreground">Open this wallet on the device where it was created to receive.</p> : null}
      {tab === "send" ? <WalletSendPane userId={userId} wallet={wallet} record={record ?? null} balance={balance} settings={settings} name={name} onSent={() => void runSyncPass()} /> : null}
      {tab === "activity" ? <WalletActivityPane userId={userId} walletId={wallet.id} balance={balance} explorerBaseUrl={settings.explorerBaseUrl} /> : null}
      {tab === "settings" ? <WalletLedgerSettingsPane settings={settings} envelopes={discretionaryEnvelopes} onSave={persistSettings} name={name} onRename={onRenamed ? rename : undefined} /> : null}
      {tab === "security" ? <WalletSecurityPane wallet={wallet} record={record ?? null} /> : null}
    </div>
  )
}
