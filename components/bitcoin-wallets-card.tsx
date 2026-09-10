"use client"

/**
 * Settings → Integrations → Bitcoin wallets.
 *
 * Privacy contract for everything in this file:
 *  - The xpub the user pastes is encrypted at rest with their unlocked privacy
 *    key and stored only in `localStorage`. Nothing in this component ever
 *    sends an xpub, derived address, or txid to the BitBudget backend.
 *  - All explorer requests go through {@link EsploraClient}, which only ever
 *    talks to the user-configured base URL.
 *  - The transactions written through `addTransaction` go through the existing
 *    asymmetric-encryption path so payee/notes are ciphertext server-side.
 */

import { useCallback, useEffect, useMemo, useState } from "react"
import { Bitcoin, Loader2, Pencil, Plus, RefreshCw, ShieldAlert, Trash2 } from "lucide-react"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useApp } from "@/lib/app-context"
import { deriveAddress, extendedKeyVersionHex, parseExtendedKey } from "@/lib/wallets/xpub-derive"
import { useBtcPrices } from "@/lib/btc-price-context"
import {
  DEFAULT_EXPLORER_URL,
  DEFAULT_GAP_LIMIT,
  DEFAULT_RECEIVE_MODE,
  buildStoredWallet,
  isAllowedExplorerBase,
  loadWallets,
  saveWallets,
  type StoredWallet,
  type WalletKind,
  type WalletReceiveMode,
} from "@/lib/wallets/xpub-store"
import {
  deleteWalletData,
  getImportedTxidsForWallet,
  getMeta,
  getUsedAddressesForOtherWallets,
} from "@/lib/wallets/xpub-cache"
import { EsploraClient } from "@/lib/wallets/esplora-client"
import { runSync, type SyncProgress } from "@/lib/wallets/xpub-sync"
import { findSavingsEnvelope } from "@/lib/savings-ui-metrics"
import type { Envelope } from "@/lib/data"
import { EnvelopeSelect, ReceiveModeField, describeLedgerRouting } from "@/components/wallet/ledger-routing-fields"

type AddStep = "warning" | "form"

interface SyncState {
  status: "idle" | "running" | "ok" | "error"
  progress?: SyncProgress
  imported?: number
  error?: string
}

const cardClass = "p-6 bg-[#0D0D0D] rounded-2xl"
const subRowClass =
  "flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-4 rounded-xl border border-[#333] bg-[#1A1A1A]"
const primaryBtnClass =
  "inline-flex items-center justify-center gap-2 rounded-xl bg-[#F7931A] px-4 py-2 text-sm font-semibold text-[#0D0D0D] transition-colors hover:bg-[#F7931A]/90 disabled:opacity-60 disabled:cursor-not-allowed"
const secondaryBtnClass =
  "inline-flex items-center justify-center gap-2 rounded-xl border border-[#333] bg-[#1A1A1A] px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground hover:border-[#555] disabled:opacity-60 disabled:cursor-not-allowed"
const dangerBtnClass =
  "inline-flex items-center justify-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs font-medium text-red-300 transition-colors hover:bg-red-500/20 disabled:opacity-60 disabled:cursor-not-allowed"

function maskXpub(xpub: string): string {
  if (xpub.length <= 14) return xpub
  return `${xpub.slice(0, 8)}…${xpub.slice(-6)}`
}

function formatLastSync(iso: string | null): string {
  if (!iso) return "Never synced"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "Never synced"
  return d.toLocaleString()
}

export function BitcoinWalletsCard() {
  const { state, currentUserId, getPrivacyKey, addTransaction, deleteTransaction, encryption, discretionaryEnvelopes } = useApp()
  const { getPriceOnDate } = useBtcPrices()

  const [wallets, setWallets] = useState<StoredWallet[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [syncStates, setSyncStates] = useState<Record<string, SyncState>>({})
  const [syncAllBusy, setSyncAllBusy] = useState(false)

  const [addOpen, setAddOpen] = useState(false)
  const [addStep, setAddStep] = useState<AddStep>("warning")
  const [warningAcknowledged, setWarningAcknowledged] = useState(false)

  // Form state
  const [formXpub, setFormXpub] = useState("")
  const [formNickname, setFormNickname] = useState("")
  const [formExplorer, setFormExplorer] = useState(DEFAULT_EXPLORER_URL)
  const [formGapLimit, setFormGapLimit] = useState(DEFAULT_GAP_LIMIT)
  const [formDefaultEnvelopeId, setFormDefaultEnvelopeId] = useState<string>("")
  const [formReceiveMode, setFormReceiveMode] = useState<WalletReceiveMode>(DEFAULT_RECEIVE_MODE)
  const [formError, setFormError] = useState<string | null>(null)
  const [formBusy, setFormBusy] = useState(false)

  const savingsEnvelopeId = findSavingsEnvelope(state.envelopes)?.id ?? null

  const detectedKind = useMemo<WalletKind | null>(() => {
    const trimmed = formXpub.trim()
    if (!trimmed) return null
    const v = extendedKeyVersionHex(trimmed)
    if (v === "0488b21e") return "bip44"
    if (v === "049d7cb2") return "bip49"
    if (v === "04b24746") return "bip84"
    return null
  }, [formXpub])

  const previewAddresses = useMemo<string[] | null>(() => {
    if (!detectedKind) return null
    try {
      const parsed = parseExtendedKey(formXpub.trim())
      const out: string[] = []
      for (let i = 0; i < 3; i++) out.push(deriveAddress(parsed, 0, i))
      return out
    } catch {
      return null
    }
  }, [formXpub, detectedKind])

  const reloadWallets = useCallback(async () => {
    if (!currentUserId) return
    const key = getPrivacyKey()
    if (!key) {
      setLoading(false)
      setLoadError("Unlock BitBudget to manage your Bitcoin wallets.")
      setWallets([])
      return
    }
    setLoading(true)
    setLoadError(null)
    try {
      const list = await loadWallets(currentUserId, key)
      setWallets(list)
    } catch (e) {
      setLoadError((e as Error).message ?? "Failed to load wallets")
    } finally {
      setLoading(false)
    }
  }, [currentUserId, getPrivacyKey])

  useEffect(() => {
    if (!state.opportunityCostEnabled) return
    if (!encryption.ready) return
    void reloadWallets()
  }, [state.opportunityCostEnabled, encryption.ready, reloadWallets])

  const resetAddForm = () => {
    setFormXpub("")
    setFormNickname("")
    setFormExplorer(DEFAULT_EXPLORER_URL)
    setFormGapLimit(DEFAULT_GAP_LIMIT)
    setFormDefaultEnvelopeId("")
    setFormReceiveMode(DEFAULT_RECEIVE_MODE)
    setFormError(null)
    setAddStep("warning")
    setWarningAcknowledged(false)
  }

  const handleAdd = async () => {
    if (!currentUserId) return
    setFormError(null)
    if (!formXpub.trim()) return setFormError("Please paste an xpub, ypub, or zpub.")
    if (!formNickname.trim()) return setFormError("Please give this wallet a nickname.")
    if (!formDefaultEnvelopeId) return setFormError("Choose the envelope this wallet's spending comes from.")
    let kind: WalletKind
    try {
      const parsed = parseExtendedKey(formXpub.trim())
      kind = parsed.kind
    } catch (e) {
      return setFormError((e as Error).message)
    }
    const explorerCheck = isAllowedExplorerBase(formExplorer.trim())
    if (!explorerCheck.ok) return setFormError(explorerCheck.reason)
    const gap = Number(formGapLimit)
    if (!Number.isInteger(gap) || gap < 1 || gap > 200) {
      return setFormError("Gap limit must be an integer between 1 and 200.")
    }

    setFormBusy(true)
    try {
      const key = getPrivacyKey()
      if (!key) throw new Error("Unlock BitBudget first.")
      const wallet = buildStoredWallet({
        nickname: formNickname,
        xpub: formXpub,
        kind,
        explorerBaseUrl: formExplorer,
        gapLimit: gap,
        defaultEnvelopeId: formDefaultEnvelopeId,
        receiveMode: formReceiveMode,
      })
      const next = [...wallets, wallet]
      await saveWallets(currentUserId, key, next)
      setWallets(next)
      setAddOpen(false)
      resetAddForm()
    } catch (e) {
      setFormError((e as Error).message)
    } finally {
      setFormBusy(false)
    }
  }

  const handleRemove = async (wallet: StoredWallet, alsoDeleteImported: boolean) => {
    if (!currentUserId) return
    const key = getPrivacyKey()
    if (!key) return
    if (alsoDeleteImported) {
      try {
        const records = await getImportedTxidsForWallet(currentUserId, wallet.id)
        for (const r of records) {
          if (!r.bitbudgetTxnId) continue
          deleteTransaction(r.bitbudgetTxnId)
        }
      } catch {
        /* best-effort; cache cleanup proceeds either way */
      }
    }
    await deleteWalletData(currentUserId, wallet.id)
    const next = wallets.filter((w) => w.id !== wallet.id)
    await saveWallets(currentUserId, key, next)
    setWallets(next)
  }

  const handleUpdate = useCallback(async (
    wallet: StoredWallet,
    patch: Pick<StoredWallet, "defaultEnvelopeId" | "receiveMode" | "explorerBaseUrl" | "nickname">,
  ) => {
    if (!currentUserId) return
    const key = getPrivacyKey()
    if (!key) throw new Error("Unlock BitBudget first.")
    const explorerCheck = isAllowedExplorerBase(patch.explorerBaseUrl.trim())
    if (!explorerCheck.ok) throw new Error(explorerCheck.reason)
    if (!patch.nickname.trim()) throw new Error("Please give this wallet a nickname.")
    if (!patch.defaultEnvelopeId) throw new Error("Choose the envelope this wallet's spending comes from.")
    const updated: StoredWallet = { ...wallet, ...patch, nickname: patch.nickname.trim() }
    const next = wallets.map((w) => (w.id === wallet.id ? updated : w))
    await saveWallets(currentUserId, key, next)
    setWallets(next)
  }, [currentUserId, getPrivacyKey, wallets])

  /**
   * One sync pass for one wallet. `importTransactions: false` only refreshes
   * the wallet's address cache (used as pass 1 of "Sync all").
   */
  const syncOne = useCallback(async (
    wallet: StoredWallet,
    importTransactions: boolean,
  ): Promise<number> => {
    if (!currentUserId) return 0
    if (importTransactions && !savingsEnvelopeId) {
      throw new Error("Your Savings envelope is still being set up. Try again in a moment.")
    }
    if (importTransactions && !wallet.defaultEnvelopeId) {
      throw new Error("Choose an envelope for this wallet before syncing.")
    }
    const client = new EsploraClient({ baseUrl: wallet.explorerBaseUrl })
    const meta = await getMeta(currentUserId, wallet.id)
    const resumeFrom = meta
      ? {
          externalIndex: Math.max(0, meta.externalScanHigh - wallet.gapLimit),
          changeIndex: Math.max(0, meta.changeScanHigh - wallet.gapLimit),
        }
      : undefined
    const otherWalletAddresses = await getUsedAddressesForOtherWallets(currentUserId, wallet.id)
    const res = await runSync({
      userId: currentUserId,
      wallet,
      savingsEnvelopeId: savingsEnvelopeId ?? "",
      client,
      resumeFrom,
      otherWalletAddresses,
      importTransactions,
      getPriceOnDate,
      saveTransaction: (txn) => addTransaction(txn),
      onProgress: (p) =>
        setSyncStates((s) => ({ ...s, [wallet.id]: { status: "running", progress: p } })),
    })
    return res.txsImported
  }, [addTransaction, currentUserId, getPriceOnDate, savingsEnvelopeId])

  const markSynced = useCallback(async (ids: string[]) => {
    if (!currentUserId) return
    const now = new Date().toISOString()
    const nextList = wallets.map((w) => (ids.includes(w.id) ? { ...w, lastSyncAt: now } : w))
    const key = getPrivacyKey()
    if (key) await saveWallets(currentUserId, key, nextList)
    setWallets(nextList)
  }, [currentUserId, getPrivacyKey, wallets])

  const handleSync = useCallback(async (wallet: StoredWallet) => {
    setSyncStates((s) => ({ ...s, [wallet.id]: { status: "running" } }))
    try {
      const imported = await syncOne(wallet, true)
      await markSynced([wallet.id])
      setSyncStates((s) => ({ ...s, [wallet.id]: { status: "ok", imported } }))
    } catch (e) {
      setSyncStates((s) => ({
        ...s,
        [wallet.id]: { status: "error", error: (e as Error).message },
      }))
    }
  }, [markSynced, syncOne])

  /**
   * Two passes so a transfer between two of the user's wallets is recognised
   * no matter which wallet is scanned first: pass 1 refreshes every wallet's
   * address cache; pass 2 classifies with all addresses known.
   */
  const handleSyncAll = useCallback(async () => {
    if (wallets.length === 0) return
    setSyncAllBusy(true)
    setSyncStates(Object.fromEntries(wallets.map((w) => [w.id, { status: "running" as const }])))
    const okIds: string[] = []
    try {
      for (const w of wallets) {
        try {
          await syncOne(w, false)
        } catch (e) {
          setSyncStates((s) => ({ ...s, [w.id]: { status: "error", error: (e as Error).message } }))
        }
      }
      for (const w of wallets) {
        try {
          const imported = await syncOne(w, true)
          okIds.push(w.id)
          setSyncStates((s) => ({ ...s, [w.id]: { status: "ok", imported } }))
        } catch (e) {
          setSyncStates((s) => ({ ...s, [w.id]: { status: "error", error: (e as Error).message } }))
        }
      }
      if (okIds.length > 0) await markSynced(okIds)
    } finally {
      setSyncAllBusy(false)
    }
  }, [markSynced, syncOne, wallets])

  if (!state.opportunityCostEnabled) {
    return null
  }

  return (
    <div className={cardClass} data-wallet-asset-group="bitbudget-wallet-assets:advanced:v1">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-4">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div className="p-2 rounded-lg bg-[#F7931A]/10 shrink-0">
            <Bitcoin className="h-5 w-5 text-[#F7931A]" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-lg font-semibold text-foreground">Bitcoin wallets</h3>
            <p className="text-sm text-muted-foreground">
              Track spending and receiving from one or more wallets via their public xpub. Spending shows
              up in the envelope you choose; receiving grows Savings or that envelope. Your xpub never
              leaves this device.
            </p>
          </div>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 shrink-0">
          {wallets.length > 1 ? (
            <button
              type="button"
              onClick={() => void handleSyncAll()}
              disabled={syncAllBusy}
              className={`${secondaryBtnClass} w-full sm:w-auto`}
            >
              {syncAllBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Sync all
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => { resetAddForm(); setAddOpen(true) }}
            className={`${primaryBtnClass} w-full sm:w-auto`}
          >
            <Plus className="h-4 w-4" /> Add wallet
          </button>
        </div>
      </div>

      {loadError && (
        <div className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
          {loadError}
        </div>
      )}

      {loading && wallets.length === 0 ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading wallets…
        </div>
      ) : wallets.length === 0 ? (
        <p className="text-sm text-muted-foreground">No wallets yet.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {wallets.map((w) => {
            const sync = syncStates[w.id]
            return (
              <div key={w.id} className={subRowClass}>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-foreground truncate">{w.nickname}</p>
                  <p className="text-xs text-muted-foreground">
                    <span className="uppercase tracking-wider">{w.kind}</span> · {maskXpub(w.xpub)} · {formatLastSync(w.lastSyncAt)}
                  </p>
                  <p className="text-xs text-muted-foreground/70 truncate">Explorer: {w.explorerBaseUrl}</p>
                  <p className={`text-xs mt-1 ${w.defaultEnvelopeId ? "text-muted-foreground" : "text-amber-300"}`}>
                    {describeLedgerRouting(w, state.envelopes)}
                  </p>
                  {sync?.status === "running" && (
                    <p className="text-xs text-[#F7931A] mt-1">
                      Syncing… {sync.progress?.scannedAddresses ?? 0} addresses scanned, {sync.progress?.txsFound ?? 0} txs found
                    </p>
                  )}
                  {sync?.status === "ok" && (
                    <p className="text-xs text-green-400 mt-1">Imported {sync.imported ?? 0} new transaction{sync.imported === 1 ? "" : "s"}.</p>
                  )}
                  {sync?.status === "error" && (
                    <p className="text-xs text-red-400 mt-1">Sync failed: {sync.error}</p>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={() => void handleSync(w)}
                    disabled={sync?.status === "running"}
                    className={secondaryBtnClass}
                  >
                    {sync?.status === "running"
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : <RefreshCw className="h-3.5 w-3.5" />}
                    Sync now
                  </button>
                  <EditWalletButton
                    wallet={w}
                    envelopes={discretionaryEnvelopes}
                    onSave={(patch) => handleUpdate(w, patch)}
                  />
                  <RemoveWalletButton wallet={w} onConfirm={(also) => void handleRemove(w, also)} />
                </div>
              </div>
            )
          })}
        </div>
      )}

      <Dialog open={addOpen} onOpenChange={(open) => { setAddOpen(open); if (!open) resetAddForm() }}>
        <DialogContent className="border-[#333] bg-[#0D0D0D] text-foreground max-w-[min(96vw,32rem)]">
          {addStep === "warning" ? (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <ShieldAlert className="h-5 w-5 text-[#F7931A]" />
                  Before you connect a wallet
                </DialogTitle>
                <DialogDescription>
                  Your xpub never leaves this device. BitBudget&apos;s servers never see it.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3 text-sm text-muted-foreground">
                <p>
                  Address-level scanning happens directly between this browser and the block
                  explorer you choose (default: <span className="font-mono text-foreground">mempool.space</span>).
                  That explorer will see your IP correlated with the addresses we look up.
                </p>
                <p>
                  For maximum privacy, point this at <span className="font-medium text-foreground">your own node</span>
                  {" "}(Umbrel, Esplora, Blockstream self-host). You can configure that in the next step.
                </p>
                <label className="flex items-start gap-3 text-xs text-foreground/90 mt-2">
                  <Switch
                    checked={warningAcknowledged}
                    onCheckedChange={setWarningAcknowledged}
                    aria-label="I understand my chosen explorer will see my wallet's addresses"
                    className="mt-0.5"
                  />
                  <span>I understand my chosen explorer will see my wallet&apos;s addresses.</span>
                </label>
              </div>
              <DialogFooter>
                <button
                  type="button"
                  onClick={() => setAddOpen(false)}
                  className="rounded-xl border border-[#333] bg-[#1A1A1A] px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-[#222]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={!warningAcknowledged}
                  onClick={() => setAddStep("form")}
                  className={primaryBtnClass}
                >
                  Continue
                </button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Connect a Bitcoin wallet</DialogTitle>
                <DialogDescription>
                  Paste your account-level xpub, ypub, or zpub. Address derivation happens here in
                  your browser.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-3">
                <div>
                  <Label htmlFor="xpub-nickname">Nickname</Label>
                  <Input
                    id="xpub-nickname"
                    value={formNickname}
                    onChange={(e) => setFormNickname(e.target.value)}
                    placeholder="Cold storage"
                  />
                </div>
                <div>
                  <Label htmlFor="xpub-input">Extended public key</Label>
                  <textarea
                    id="xpub-input"
                    value={formXpub}
                    onChange={(e) => setFormXpub(e.target.value)}
                    placeholder="xpub… / ypub… / zpub…"
                    rows={3}
                    className="w-full rounded-xl border border-[#333] bg-[#1A1A1A] p-3 text-sm font-mono text-foreground"
                  />
                  {detectedKind && (
                    <p className="text-xs text-green-400 mt-1">Detected: {detectedKind.toUpperCase()}</p>
                  )}
                  {previewAddresses && (
                    <div className="mt-2 rounded-lg bg-[#0D0D0D] border border-[#333] p-3">
                      <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">First 3 receive addresses</p>
                      {previewAddresses.map((a) => (
                        <p key={a} className="text-xs font-mono text-foreground break-all">{a}</p>
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <Label htmlFor="xpub-explorer">Block explorer URL</Label>
                  <Input
                    id="xpub-explorer"
                    value={formExplorer}
                    onChange={(e) => setFormExplorer(e.target.value)}
                    placeholder="https://mempool.space"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Use any Esplora-compatible API. Plain http:// is allowed only for local-network
                    nodes (.local, .onion, loopback, RFC1918).
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="xpub-gaplimit">Gap limit</Label>
                    <Input
                      id="xpub-gaplimit"
                      type="number"
                      min={1}
                      max={200}
                      value={formGapLimit}
                      onChange={(e) => setFormGapLimit(Number(e.target.value))}
                    />
                  </div>
                  <div>
                    <Label htmlFor="xpub-default-envelope">Spending envelope</Label>
                    <EnvelopeSelect
                      id="xpub-default-envelope"
                      value={formDefaultEnvelopeId}
                      onChange={setFormDefaultEnvelopeId}
                      envelopes={discretionaryEnvelopes}
                    />
                  </div>
                </div>
                <ReceiveModeField
                  idPrefix="xpub-add"
                  value={formReceiveMode}
                  onChange={setFormReceiveMode}
                  envelopeName={discretionaryEnvelopes.find((e) => e.id === formDefaultEnvelopeId)?.name}
                />
                {formError && (
                  <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-300">{formError}</div>
                )}
              </div>
              <DialogFooter>
                <button type="button" onClick={() => setAddOpen(false)} className="rounded-xl border border-[#333] bg-[#1A1A1A] px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-[#222]">
                  Cancel
                </button>
                <button type="button" disabled={formBusy} onClick={() => void handleAdd()} className={primaryBtnClass}>
                  {formBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Save wallet
                </button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function EditWalletButton({
  wallet,
  envelopes,
  onSave,
}: {
  wallet: StoredWallet
  envelopes: readonly Envelope[]
  onSave: (patch: Pick<StoredWallet, "defaultEnvelopeId" | "receiveMode" | "explorerBaseUrl" | "nickname">) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [nickname, setNickname] = useState(wallet.nickname)
  const [envelopeId, setEnvelopeId] = useState(wallet.defaultEnvelopeId ?? "")
  const [receiveMode, setReceiveMode] = useState<WalletReceiveMode>(wallet.receiveMode)
  const [explorer, setExplorer] = useState(wallet.explorerBaseUrl)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const openDialog = () => {
    setNickname(wallet.nickname)
    setEnvelopeId(wallet.defaultEnvelopeId ?? "")
    setReceiveMode(wallet.receiveMode)
    setExplorer(wallet.explorerBaseUrl)
    setError(null)
    setOpen(true)
  }

  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      await onSave({ nickname, defaultEnvelopeId: envelopeId || null, receiveMode, explorerBaseUrl: explorer })
      setOpen(false)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button type="button" onClick={openDialog} className={secondaryBtnClass} aria-label={`Edit ${wallet.nickname}`}>
        <Pencil className="h-3.5 w-3.5" /> Edit
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="border-[#333] bg-[#0D0D0D] text-foreground max-w-[min(96vw,32rem)]">
          <DialogHeader>
            <DialogTitle>Edit “{wallet.nickname}”</DialogTitle>
            <DialogDescription>
              Change where this wallet&apos;s activity shows up in your budget. Already-imported transactions are not moved.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div>
              <Label htmlFor={`edit-${wallet.id}-nickname`}>Nickname</Label>
              <Input id={`edit-${wallet.id}-nickname`} value={nickname} onChange={(e) => setNickname(e.target.value)} />
            </div>
            <div>
              <Label htmlFor={`edit-${wallet.id}-envelope`}>Spending envelope</Label>
              <EnvelopeSelect id={`edit-${wallet.id}-envelope`} value={envelopeId} onChange={setEnvelopeId} envelopes={envelopes} />
            </div>
            <ReceiveModeField
              idPrefix={`edit-${wallet.id}`}
              value={receiveMode}
              onChange={setReceiveMode}
              envelopeName={envelopes.find((e) => e.id === envelopeId)?.name}
            />
            <div>
              <Label htmlFor={`edit-${wallet.id}-explorer`}>Block explorer URL</Label>
              <Input id={`edit-${wallet.id}-explorer`} value={explorer} onChange={(e) => setExplorer(e.target.value)} />
            </div>
            {error && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-300">{error}</div>
            )}
          </div>
          <DialogFooter>
            <button type="button" onClick={() => setOpen(false)} className="rounded-xl border border-[#333] bg-[#1A1A1A] px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-[#222]">
              Cancel
            </button>
            <button type="button" disabled={busy} onClick={() => void save()} className={primaryBtnClass}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Save changes
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function RemoveWalletButton({
  wallet,
  onConfirm,
}: {
  wallet: StoredWallet
  onConfirm: (alsoDeleteImported: boolean) => void
}) {
  const [open, setOpen] = useState(false)
  const [alsoDelete, setAlsoDelete] = useState(false)
  return (
    <>
      <button type="button" onClick={() => { setAlsoDelete(false); setOpen(true) }} className={dangerBtnClass}>
        <Trash2 className="h-3.5 w-3.5" /> Remove
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="border-[#333] bg-[#0D0D0D] text-foreground max-w-[min(96vw,28rem)]">
          <DialogHeader>
            <DialogTitle>Remove “{wallet.nickname}”?</DialogTitle>
            <DialogDescription>
              The wallet&apos;s xpub and local cache will be deleted from this device. Already-imported
              BitBudget transactions are kept by default.
            </DialogDescription>
          </DialogHeader>
          <label className="flex items-start gap-3 text-sm text-foreground/90">
            <Switch
              checked={alsoDelete}
              onCheckedChange={setAlsoDelete}
              aria-label="Also delete every BitBudget transaction this wallet has imported"
              className="mt-0.5"
            />
            <span>Also delete every BitBudget transaction this wallet has imported.</span>
          </label>
          <DialogFooter>
            <button type="button" onClick={() => setOpen(false)} className="rounded-xl border border-[#333] bg-[#1A1A1A] px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-[#222]">
              Cancel
            </button>
            <button type="button" onClick={() => { onConfirm(alsoDelete); setOpen(false) }} className="rounded-xl bg-red-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-500/90">
              Remove
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
