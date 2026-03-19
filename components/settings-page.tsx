"use client"

import { useState, useRef, useEffect } from "react"
import { useApp } from "@/lib/app-context"
import { formatUsd } from "@/lib/data"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { CSVImportDialog } from "@/components/csv-import-dialog"
import { Upload, Shield, DollarSign, Trash2, UserX, Bitcoin, TrendingUp, Crown, Building2, Smartphone, Mail, Tag, Copy, Check } from "lucide-react"
import { PlaidLinkButton } from "@/components/plaid-link-button"

export function SettingsPage() {
  type SettingsTab = "general" | "integrations" | "tags" | "data"
  const { state, setMonthlyIncome, setBtcDisplayUnit, setOpportunityCostEnabled, addTag, deleteTag, refreshData, encryptForStorage, logout, subscriptionTier, navigateTo } = useApp()
  const [editingIncome, setEditingIncome] = useState(false)
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("general")
  const [incomeValue, setIncomeValue] = useState(String(state.monthlyIncome))
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDeleteAccount, setConfirmDeleteAccount] = useState(false)
  const [deletingAccount, setDeletingAccount] = useState(false)
  const [receiptInboxAddress, setReceiptInboxAddress] = useState<string | null>(null)
  const [receiptInboxLoading, setReceiptInboxLoading] = useState(false)
  const [newTagName, setNewTagName] = useState("")
  const [tagActionInProgress, setTagActionInProgress] = useState(false)
  const [copiedReceiptAddress, setCopiedReceiptAddress] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let cancelled = false
    async function loadReceiptInbox() {
      setReceiptInboxLoading(true)
      try {
        const res = await fetch("/api/user/receipt-inbox")
        if (!res.ok) return
        const data = await res.json()
        if (!cancelled) {
          setReceiptInboxAddress(data.receiptInboxAddress ?? null)
        }
      } finally {
        if (!cancelled) setReceiptInboxLoading(false)
      }
    }
    loadReceiptInbox()
    return () => {
      cancelled = true
    }
  }, [])

  async function handleClearAll() {
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }
    setDeleting(true)
    try {
      await Promise.all([
        fetch("/api/transactions?all=true", { method: "DELETE" }),
        fetch("/api/envelopes?all=true", { method: "DELETE" }),
      ])
      await refreshData()
    } finally {
      setDeleting(false)
      setConfirmDelete(false)
    }
  }

  async function handleAddTag() {
    const trimmed = newTagName.trim()
    if (!trimmed || tagActionInProgress) return

    setTagActionInProgress(true)
    try {
      await addTag(trimmed)
      setNewTagName("")
      await refreshData()
    } finally {
      setTagActionInProgress(false)
    }
  }

  async function handleDeleteTag(id: string) {
    if (tagActionInProgress) return

    setTagActionInProgress(true)
    try {
      await deleteTag(id)
      await refreshData()
    } finally {
      setTagActionInProgress(false)
    }
  }

  async function copyReceiptInboxAddress() {
    if (!receiptInboxAddress) return
    await navigator.clipboard.writeText(receiptInboxAddress)
    setCopiedReceiptAddress(true)
    window.setTimeout(() => setCopiedReceiptAddress(false), 1500)
  }

  function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setImportFile(file)
    setImportOpen(true)
    e.target.value = ""
  }

  const tabButtonClass = (tab: SettingsTab) =>
    `flex items-center justify-between rounded-xl px-4 py-3 text-left text-sm font-medium transition-colors ${
      settingsTab === tab
        ? "bg-[#1A1A1A] text-[#F7931A] border border-[#F7931A]/20"
        : "text-muted-foreground hover:text-foreground hover:bg-[#111111]"
    }`

  const generalSection = (
    <>
      {/* Plan / Tier */}
      <div className="p-6 bg-[#0D0D0D] rounded-2xl">
        <div className="flex items-center gap-3 mb-4">
          <div className={`p-2 rounded-lg ${subscriptionTier === "premium" ? "bg-[#F7931A]/20" : "bg-[#333]/50"}`}>
            <Crown className={`h-5 w-5 ${subscriptionTier === "premium" ? "text-[#F7931A]" : "text-muted-foreground"}`} />
          </div>
          <h3 className="text-lg font-semibold text-foreground">Plan</h3>
        </div>
        <div className="flex items-center gap-3">
          <span
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold ${
              subscriptionTier === "premium"
                ? "bg-[#F7931A]/15 text-[#F7931A] border border-[#F7931A]/30"
                : "bg-[#1A1A1A] text-muted-foreground border border-[#333]"
            }`}
          >
            {subscriptionTier === "premium" ? (
              <>
                <Crown className="h-4 w-4" />
                Premium
              </>
            ) : (
              "Free"
            )}
          </span>
          {subscriptionTier === "premium" && (
            <span className="text-sm text-muted-foreground">
              You have access to bank sync, SMS alerts, and connected email.
            </span>
          )}
        </div>
      </div>

      {/* Income */}
      <div className="p-6 bg-[#0D0D0D] rounded-2xl">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-lg bg-[#22C55E]/10">
            <DollarSign className="h-5 w-5 text-[#22C55E]" />
          </div>
          <h3 className="text-lg font-semibold text-foreground">Monthly Income</h3>
        </div>
        {editingIncome ? (
          <div className="flex items-center gap-3">
            <span className="text-muted-foreground">$</span>
            <Input
              type="number"
              value={incomeValue}
              onChange={e => setIncomeValue(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter") {
                  setMonthlyIncome(parseFloat(incomeValue) || state.monthlyIncome)
                  setEditingIncome(false)
                }
                if (e.key === "Escape") setEditingIncome(false)
              }}
              onBlur={() => {
                setMonthlyIncome(parseFloat(incomeValue) || state.monthlyIncome)
                setEditingIncome(false)
              }}
              className="bg-[#1A1A1A] border-[#333] text-foreground h-10 w-40"
              autoFocus
            />
          </div>
        ) : (
          <button
            onClick={() => {
              setIncomeValue(String(state.monthlyIncome))
              setEditingIncome(true)
            }}
            className="text-3xl font-bold text-foreground hover:text-[#F7931A] transition-colors"
          >
            {formatUsd(state.monthlyIncome)}
          </button>
        )}
      </div>

      {/* Opportunity Cost */}
      <div className="p-4 md:p-6 bg-[#0D0D0D] rounded-2xl">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-lg bg-[#F7931A]/10">
            <TrendingUp className="h-5 w-5 text-[#F7931A]" />
          </div>
          <h3 className="text-lg font-semibold text-foreground">Opportunity Cost</h3>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Show the Bitcoin opportunity cost of your spending — the BTC you could have stacked with each purchase.
        </p>
        <div className="flex rounded-lg bg-[#1A1A1A] p-1 w-fit">
          <button
            onClick={() => setOpportunityCostEnabled(true)}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
              state.opportunityCostEnabled
                ? "bg-[#F7931A] text-[#0D0D0D]"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Enabled
          </button>
          <button
            onClick={() => setOpportunityCostEnabled(false)}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
              !state.opportunityCostEnabled
                ? "bg-[#F7931A] text-[#0D0D0D]"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Disabled
          </button>
        </div>
        <p className="text-xs text-muted-foreground mt-3">
          {state.opportunityCostEnabled
            ? "Showing BTC opportunity cost charts, values, and metrics."
            : "Hidden. Enable to see BTC values and opportunity cost insights."}
        </p>
      </div>

      {/* BTC Display — only shown when opportunity cost is enabled */}
      {state.opportunityCostEnabled && (
        <div className="p-4 md:p-6 bg-[#0D0D0D] rounded-2xl">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 rounded-lg bg-[#F7931A]/10">
              <Bitcoin className="h-5 w-5 text-[#F7931A]" />
            </div>
            <h3 className="text-lg font-semibold text-foreground">BTC Display</h3>
          </div>
          <p className="text-sm text-muted-foreground mb-4">
            Choose how Bitcoin amounts are shown throughout the app.
          </p>
          <div className="flex rounded-lg bg-[#1A1A1A] p-1 w-fit">
            <button
              onClick={() => setBtcDisplayUnit("sats")}
              className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                state.btcDisplayUnit === "sats"
                  ? "bg-[#F7931A] text-[#0D0D0D]"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Sats
            </button>
            <button
              onClick={() => setBtcDisplayUnit("btc")}
              className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                state.btcDisplayUnit === "btc"
                  ? "bg-[#F7931A] text-[#0D0D0D]"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              BTC
            </button>
          </div>
          <p className="text-xs text-muted-foreground mt-3">
            {state.btcDisplayUnit === "sats"
              ? "Showing values in satoshis (1 BTC = 100,000,000 sats)"
              : "Showing values as decimal BTC (e.g. 0.00004013 BTC)"}
          </p>
        </div>
      )}
    </>
  )

  const integrationsSection = (
    <>
      {/* Receipt Inbox */}
      <div className="p-6 bg-[#0D0D0D] rounded-2xl">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-lg bg-[#06B6D4]/10">
            <Mail className="h-5 w-5 text-[#06B6D4]" />
          </div>
          <h3 className="text-lg font-semibold text-foreground">Receipt Inbox</h3>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Forward receipts to your dedicated address and they&apos;ll be saved for your review later. We recommend bookmarking this address
        </p>
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2 rounded-xl border border-[#333] bg-[#1A1A1A] px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">Inbound address</p>
              <p className="font-mono text-base text-foreground break-all">
                {receiptInboxLoading ? "Generating..." : receiptInboxAddress || "Loading..."}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void copyReceiptInboxAddress()}
              disabled={!receiptInboxAddress || receiptInboxLoading}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#333] bg-[#0D0D0D] px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground hover:border-[#555] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {copiedReceiptAddress ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copiedReceiptAddress ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      </div>

      {/* Premium: Connections */}
      {subscriptionTier === "premium" && (
        <div className="p-6 bg-[#0D0D0D] rounded-2xl">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 rounded-lg bg-[#F7931A]/20">
              <Building2 className="h-5 w-5 text-[#F7931A]" />
            </div>
            <h3 className="text-lg font-semibold text-foreground">Connections</h3>
          </div>
          <p className="text-sm text-muted-foreground mb-6">
            Connect your accounts to automatically import transactions.
          </p>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-4 rounded-xl border border-[#333] bg-[#1A1A1A]">
              <div className="flex items-start gap-3">
                <Building2 className="h-5 w-5 text-[#F7931A] shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-foreground">Bank sync</p>
                  <p className="text-sm text-muted-foreground">
                    Link your bank or credit card to import transactions automatically via Plaid.
                  </p>
                </div>
              </div>
              <PlaidLinkButton />
            </div>
            <div className="flex flex-col gap-3 p-4 rounded-xl border border-[#333] bg-[#1A1A1A]">
              <div className="flex items-start gap-3">
                <Smartphone className="h-5 w-5 text-[#F7931A] shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-foreground">SMS alerts</p>
                  <p className="text-sm text-muted-foreground">
                    Forward your bank&apos;s transaction text alerts to a dedicated number to capture spending without opening the app. Contact support to get your personal forwarding number.
                  </p>
                </div>
              </div>
            </div>
            <div className="flex flex-col gap-3 p-4 rounded-xl border border-[#333] bg-[#1A1A1A]">
              <div className="flex items-start gap-3">
                <Mail className="h-5 w-5 text-[#F7931A] shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-foreground">Connected email</p>
                  <p className="text-sm text-muted-foreground">
                    Connect Gmail or Outlook to automatically scan for receipts from known senders. Coming soon.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* CSV Import */}
      <div className="p-6 bg-[#0D0D0D] rounded-2xl">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-lg bg-[#06B6D4]/10">
            <Upload className="h-5 w-5 text-[#06B6D4]" />
          </div>
          <h3 className="text-lg font-semibold text-foreground">Import Transactions</h3>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Upload a CSV file with columns: Date, Envelope, Name, Amount
        </p>
        <div className="flex flex-col gap-3">
          <input
            ref={fileRef}
            type="file"
            accept=".csv"
            onChange={handleFileSelected}
            className="hidden"
          />
          <button
            onClick={() => fileRef.current?.click()}
            className="flex items-center justify-center gap-2 py-3 px-6 bg-[#1A1A1A] text-foreground rounded-xl text-sm font-medium hover:bg-[#222] transition-colors border border-[#333]"
          >
            <Upload className="h-4 w-4" />
            Choose CSV File
          </button>
        </div>
      </div>
    </>
  )

  const tagsSection = (
    <div className="p-6 bg-[#0D0D0D] rounded-2xl">
      <div className="flex items-center gap-3 mb-4">
        <div className="p-2 rounded-lg bg-[#F7931A]/10">
          <Tag className="h-5 w-5 text-[#F7931A]" />
        </div>
        <h3 className="text-lg font-semibold text-foreground">Tags</h3>
      </div>
      <p className="text-sm text-muted-foreground mb-4">
        Create tags to organize transactions and receipts.
      </p>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-2">
          {state.tags.length > 0 ? (
            state.tags.map(tag => (
              <span
                key={tag.id}
                className="inline-flex items-center gap-2 rounded-full border border-[#333] bg-[#1A1A1A] px-3 py-1.5 text-sm text-foreground"
              >
                <span className="truncate max-w-[12rem]">{tag.name}</span>
                <button
                  type="button"
                  onClick={() => {
                    void handleDeleteTag(tag.id)
                  }}
                  disabled={tagActionInProgress}
                  className="inline-flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-[#2A2A2A] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  aria-label={`Delete tag ${tag.name}`}
                >
                  <span aria-hidden="true">×</span>
                </button>
              </span>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">No tags yet.</p>
          )}
        </div>
        <div className="flex flex-col sm:flex-row gap-3">
          <Input
            value={newTagName}
            onChange={e => setNewTagName(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter") {
                e.preventDefault()
                void handleAddTag()
              }
            }}
            placeholder="New tag"
            className="bg-[#1A1A1A] border-[#333] text-foreground h-10"
            aria-label="New tag name"
          />
          <button
            type="button"
            onClick={() => {
              void handleAddTag()
            }}
            disabled={tagActionInProgress || !newTagName.trim()}
            className="inline-flex items-center justify-center rounded-xl px-4 h-10 text-sm font-medium bg-[#F7931A] text-[#0D0D0D] hover:bg-[#e68818] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Add Tag
          </button>
        </div>
      </div>
    </div>
  )

  const dataSection = (
    <>
      {/* Security Info */}
      <div className="p-6 bg-[#0D0D0D] rounded-2xl">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-lg bg-[#8B5CF6]/10">
            <Shield className="h-5 w-5 text-[#8B5CF6]" />
          </div>
          <h3 className="text-lg font-semibold text-foreground">Privacy & Security</h3>
        </div>
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted-foreground">
            Your sensitive transaction data (payees, descriptions) is encrypted end-to-end.
            Only you can decrypt it with your PIN or Nostr key.
          </p>
          <div className="flex items-center gap-2 mt-2">
            <div className="w-2 h-2 rounded-full bg-[#22C55E]" />
            <span className="text-xs text-[#22C55E]">Encryption active</span>
          </div>
        </div>
      </div>

      {/* Data */}
      <div className="p-6 bg-[#0D0D0D] rounded-2xl">
        <h3 className="text-lg font-semibold text-foreground mb-3">Data Summary</h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label className="text-muted-foreground text-xs uppercase tracking-wider">Envelopes</Label>
            <p className="text-lg font-semibold text-foreground">{state.envelopes.length}</p>
          </div>
          <div>
            <Label className="text-muted-foreground text-xs uppercase tracking-wider">Transactions</Label>
            <p className="text-lg font-semibold text-foreground">{state.transactions.length}</p>
          </div>
        </div>
      </div>

      {/* Danger Zone */}
      <div className="p-6 bg-[#0D0D0D] rounded-2xl border border-red-500/20">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-lg bg-red-500/10">
            <Trash2 className="h-5 w-5 text-red-500" />
          </div>
          <h3 className="text-lg font-semibold text-foreground">Danger Zone</h3>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Permanently delete all {state.transactions.length} transaction{state.transactions.length !== 1 ? "s" : ""} and {state.envelopes.length} envelope{state.envelopes.length !== 1 ? "s" : ""}. This cannot be undone.
        </p>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={handleClearAll}
            onBlur={() => setConfirmDelete(false)}
            disabled={deleting || (state.transactions.length === 0 && state.envelopes.length === 0)}
            className={`flex items-center justify-center gap-2 py-3 px-6 rounded-xl text-sm font-medium transition-colors border disabled:opacity-50 ${
              confirmDelete
                ? "bg-red-600 text-white border-red-600 hover:bg-red-700"
                : "bg-[#1A1A1A] text-red-400 border-red-500/30 hover:bg-red-500/10"
            }`}
          >
            <Trash2 className="h-4 w-4" />
            {deleting ? "Deleting..." : confirmDelete ? "Click again to confirm" : "Clear All Data"}
          </button>
          <button
            onClick={async () => {
              if (!confirmDeleteAccount) {
                setConfirmDeleteAccount(true)
                return
              }
              setDeletingAccount(true)
              try {
                await fetch("/api/user/delete", { method: "DELETE" })
                logout()
              } finally {
                setDeletingAccount(false)
                setConfirmDeleteAccount(false)
              }
            }}
            onBlur={() => setConfirmDeleteAccount(false)}
            disabled={deletingAccount}
            className={`flex items-center justify-center gap-2 py-3 px-6 rounded-xl text-sm font-medium transition-colors border disabled:opacity-50 ${
              confirmDeleteAccount
                ? "bg-red-600 text-white border-red-600 hover:bg-red-700"
                : "bg-[#1A1A1A] text-red-400 border-red-500/30 hover:bg-red-500/10"
            }`}
          >
            <UserX className="h-4 w-4" />
            {deletingAccount ? "Deleting..." : confirmDeleteAccount ? "Click again to confirm" : "Delete My Account"}
          </button>
        </div>
      </div>
    </>
  )

  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-2xl font-bold text-foreground">Settings</h2>
      <div className="grid gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="lg:sticky lg:top-6 self-start">
          <div className="rounded-2xl border border-[#1F1F1F] bg-[#0D0D0D] p-2">
            <div className="flex gap-2 overflow-x-auto lg:flex-col lg:overflow-visible">
              <button type="button" onClick={() => setSettingsTab("general")} className={tabButtonClass("general")}>
                <span>General</span>
              </button>
              <button type="button" onClick={() => setSettingsTab("integrations")} className={tabButtonClass("integrations")}>
                <span>Integrations</span>
              </button>
              <button type="button" onClick={() => setSettingsTab("tags")} className={tabButtonClass("tags")}>
                <span>Tags</span>
              </button>
              <button type="button" onClick={() => setSettingsTab("data")} className={tabButtonClass("data")}>
                <span>Data & Security</span>
              </button>
            </div>
          </div>
        </aside>

        <div className="flex flex-col gap-6">
          {settingsTab === "general" && generalSection}
          {settingsTab === "integrations" && integrationsSection}
          {settingsTab === "tags" && tagsSection}
          {settingsTab === "data" && dataSection}
        </div>
      </div>

      <CSVImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        file={importFile}
        dedupExistingTransactions={state.transactions}
        onImportComplete={refreshData}
        onDone={() => {}}
        onRequestAllocations={() => {
          setImportOpen(false)
          navigateTo("envelopes")
        }}
        onTryAnotherFile={() => setImportFile(null)}
        encryptFn={encryptForStorage}
      />
    </div>
  )
}
