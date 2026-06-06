"use client"

import { useState, useRef, useEffect, useCallback, useMemo } from "react"
import { useApp } from "@/lib/app-context"
import {
  COMMUNICATION_PREFERENCE_DETAILS,
  type CommunicationPreferenceKey,
} from "@/lib/communication-preferences"
import { compareTransactionsDesc, formatUsd, formatUsdPrecise } from "@/lib/data"
import { buildExportFilename, buildTransactionsCsv } from "@/lib/transaction-export"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { CSVImportDialog } from "@/components/csv-import-dialog"
import { DuplicateCleanupCard } from "@/components/duplicate-cleanup-card"
import {
  Upload,
  Shield,
  DollarSign,
  Trash2,
  UserX,
  Bitcoin,
  TrendingUp,
  Crown,
  Building2,
  Smartphone,
  Mail,
  Copy,
  Check,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Download,
  MessageSquare,
} from "lucide-react"
import { Switch } from "@/components/ui/switch"
import { PayeeMappingsSettings } from "@/components/payee-mappings-settings"
import { RecurringRulesSettings } from "@/components/recurring-rules-settings"
import { CommunicationChannelsCard } from "@/components/communication-channels-card"
import { SETTINGS_INITIAL_TAB_STORAGE_KEY } from "@/lib/payee-mapping-dismissals"
import { PlaidConnectionsSection } from "@/components/plaid-connections-section"
import { UpgradeModal, type PremiumFeature } from "@/components/upgrade-modal"
import { SettingsReferralsCard } from "@/components/settings-referrals-card"
import { SettingsSavingsCard } from "@/components/settings-savings-card"
import { SettingsPastGoalsCard } from "@/components/settings/settings-past-goals-card"
import { SettingsTagsCard } from "@/components/settings/settings-tags-card"
import { IncomeImporterCard } from "@/components/income-importer-dialog"
import { LinkedSignInMethods } from "@/components/linked-sign-in-methods"
import { SettingsSetupGuideSection } from "@/components/settings-setup-guide-section"
import { cn } from "@/lib/utils"
import { SettingsLayout } from "@/components/settings/settings-layout"
import { SettingsLayoutModeToggle } from "@/components/settings/settings-layout-mode-toggle"
import {
  settingsInnerSectionClass,
  settingsSectionClass,
  settingsSlotClass,
} from "@/components/settings/settings-layout-utils"
import {
  getSettingsLayoutMode,
  subscribeSettingsLayoutMode,
  type SettingsLayoutMode,
} from "@/lib/settings-layout-mode"
import { SettingsSetupGuideDrawer } from "@/components/settings/settings-setup-guide-drawer"
import {
  SETTINGS_TAB_SLUGS,
  settingsTabFromLocationHash,
  type SettingsTab,
} from "@/components/settings/settings-nav-config"

export function SettingsPage() {
  const {
    state,
    activeTransactions,
    setMonthlyIncome,
    setBtcDisplayUnit,
    setOpportunityCostEnabled,
    setCommunicationPreference,
    refreshData,
    clearLocalTransactionCache,
    encryptForStorage,
    makeImportDedupeKeyComputer,
    logout,
    subscriptionTier,
    effectiveTier,
    hasPremiumFeatures,
    refereePendingBankLink,
    navigateTo,
    memoTransactionCount,
    historyReady,
  } = useApp()

  const dataTxnCount = historyReady
    ? state.transactions.length
    : Math.max(state.transactions.length, memoTransactionCount ?? 0)
  const [editingIncome, setEditingIncome] = useState(false)
  const [settingsTab, setSettingsTab] = useState<SettingsTab>(() => settingsTabFromLocationHash() ?? "general")
  const [cardLayoutMode, setCardLayoutMode] = useState<SettingsLayoutMode>("grid")

  useEffect(() => {
    setCardLayoutMode(getSettingsLayoutMode())
    return subscribeSettingsLayoutMode(() => setCardLayoutMode(getSettingsLayoutMode()))
  }, [])

  const selectSettingsTab = useCallback((tab: SettingsTab, mode: "push" | "replace" = "push") => {
    setSettingsTab(tab)
    if (typeof window === "undefined") return
    const hash = `#/settings/${SETTINGS_TAB_SLUGS[tab]}`
    if (window.location.hash !== hash) {
      if (mode === "replace") window.history.replaceState({ page: "settings", settingsTab: tab }, "", hash)
      else window.history.pushState({ page: "settings", settingsTab: tab }, "", hash)
    }
  }, [])

  useEffect(() => {
    try {
      const t = sessionStorage.getItem(SETTINGS_INITIAL_TAB_STORAGE_KEY)
      if (t === "payees") {
        selectSettingsTab("payees", "replace")
        sessionStorage.removeItem(SETTINGS_INITIAL_TAB_STORAGE_KEY)
      } else if (t === "integrations") {
        selectSettingsTab("integrations", "replace")
        sessionStorage.removeItem(SETTINGS_INITIAL_TAB_STORAGE_KEY)
      } else if (t === "general") {
        selectSettingsTab("general", "replace")
        sessionStorage.removeItem(SETTINGS_INITIAL_TAB_STORAGE_KEY)
      } else if (t === "savings" || t === "savings-tracking") {
        selectSettingsTab("savings", "replace")
        sessionStorage.removeItem(SETTINGS_INITIAL_TAB_STORAGE_KEY)
      } else if (t === "data" || t === "data-security") {
        selectSettingsTab("data", "replace")
        sessionStorage.removeItem(SETTINGS_INITIAL_TAB_STORAGE_KEY)
      }
    } catch {
      /* ignore */
    }
  }, [selectSettingsTab])

  useEffect(() => {
    function syncFromHash() {
      const next = settingsTabFromLocationHash()
      if (next) setSettingsTab(next)
    }
    window.addEventListener("popstate", syncFromHash)
    window.addEventListener("hashchange", syncFromHash)
    return () => {
      window.removeEventListener("popstate", syncFromHash)
      window.removeEventListener("hashchange", syncFromHash)
    }
  }, [])
  const [incomeValue, setIncomeValue] = useState(String(state.monthlyIncome))
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [importLoading, setImportLoading] = useState(false)
  const [importResult, setImportResult] = useState<
    | { success: true; imported: number; skipped: number; duplicates: number }
    | { success: false; error: string }
    | null
  >(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDeleteAccount, setConfirmDeleteAccount] = useState(false)
  const [deletingAccount, setDeletingAccount] = useState(false)
  const [receiptInboxAddress, setReceiptInboxAddress] = useState<string | null>(null)
  const [receiptInboxLoading, setReceiptInboxLoading] = useState(false)
  const [receiptInboxError, setReceiptInboxError] = useState<string | null>(null)
  const [receiptInboxRetryKey, setReceiptInboxRetryKey] = useState(0)
  const [upgradeModalFeature, setUpgradeModalFeature] = useState<PremiumFeature | null>(null)
  const [copiedReceiptAddress, setCopiedReceiptAddress] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const handleImportError = useCallback((error: string) => {
    setImportResult({ success: false, error })
  }, [])

  const envelopeMapForExport = useMemo(() => {
    const map: Record<string, { name: string }> = {}
    for (const e of state.envelopes) map[e.id] = { name: e.name }
    return map
  }, [state.envelopes])

  const handleExportTransactions = useCallback(() => {
    const now = new Date()
    const stampDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
    const filename = buildExportFilename({ stampDate })
    const sorted = [...activeTransactions].sort(compareTransactionsDesc)
    const rows = sorted.map(t => {
      const amount = t.type === "expense" ? -Math.abs(t.amount) : Math.abs(t.amount)
      return {
        type: t.type,
        date: t.date,
        payee: t.payee,
        amountFormatted: formatUsdPrecise(amount),
        notes: t.notes ?? "",
        envelopeName: envelopeMapForExport[t.envelopeId]?.name ?? "",
        tags: (t.tags ?? []).join(", "),
      }
    })
    const csv = buildTransactionsCsv(rows)
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = filename
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 100)
  }, [activeTransactions, envelopeMapForExport])

  useEffect(() => {
    if (!hasPremiumFeatures) {
      setReceiptInboxLoading(false)
      setReceiptInboxAddress(null)
      setReceiptInboxError(null)
      return
    }

    let cancelled = false
    async function loadReceiptInbox() {
      setReceiptInboxLoading(true)
      setReceiptInboxError(null)
      try {
        const res = await fetch("/api/user/receipt-inbox")
        const data = (await res.json().catch(() => ({}))) as {
          receiptInboxAddress?: string
          message?: string
          error?: string
        }
        if (cancelled) return
        if (!res.ok) {
          const msg =
            typeof data.message === "string"
              ? data.message
              : typeof data.error === "string" && data.error !== "Forbidden"
                ? data.error
                : res.status === 403
                  ? "Receipt inbox requires an active Premium plan."
                  : `Could not load your receipt inbox (error ${res.status}). Try again in a moment.`
          setReceiptInboxAddress(null)
          setReceiptInboxError(msg)
          return
        }
        const addr = data.receiptInboxAddress ?? null
        setReceiptInboxAddress(addr)
        if (!addr) {
          setReceiptInboxError(
            "Your inbox address was not returned. Try again or refresh the page.",
          )
        }
      } catch {
        if (!cancelled) {
          setReceiptInboxAddress(null)
          setReceiptInboxError(
            "Could not reach the server. Check your connection and try again.",
          )
        }
      } finally {
        if (!cancelled) setReceiptInboxLoading(false)
      }
    }
    void loadReceiptInbox()
    return () => {
      cancelled = true
    }
  }, [hasPremiumFeatures, receiptInboxRetryKey])

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
      try {
        await clearLocalTransactionCache()
      } catch {
        /* Server deletes already succeeded; cache clear is best-effort */
      }
      await refreshData()
    } finally {
      setDeleting(false)
      setConfirmDelete(false)
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
    setImportResult(null)
    setImportLoading(true)
    setImportFile(file)
    setImportOpen(true)
    e.target.value = ""
  }

  const toggleCommunicationPreference = useCallback(
    (key: CommunicationPreferenceKey, enabled: boolean) => {
      void setCommunicationPreference(key, enabled)
    },
    [setCommunicationPreference],
  )

  const communicationsSection = (
    <div className={settingsSectionClass(cardLayoutMode, "lg:grid-cols-2 3xl:grid-cols-3")}>
      <div className={settingsSlotClass(cardLayoutMode, "min-w-0 lg:col-span-1 3xl:col-span-1")}>
        <CommunicationChannelsCard />
      </div>
      <div
        className={settingsSlotClass(
          cardLayoutMode,
          "p-6 bg-[#0D0D0D] rounded-2xl min-w-0 lg:col-span-1 3xl:col-span-2",
        )}
      >
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-lg bg-[#3B82F6]/10">
            <MessageSquare className="h-5 w-5 text-[#3B82F6]" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-foreground">Communication Preferences</h3>
            <p className="text-sm text-muted-foreground">
              Choose which non-transactional messages BitBudget may send you.
            </p>
          </div>
        </div>
        <div
          className={cn(
            "flex flex-col divide-y divide-[#1F1F1F] rounded-xl border border-[#1F1F1F] bg-[#1A1A1A]",
            cardLayoutMode === "grid" && "3xl:grid 3xl:grid-cols-2 3xl:divide-y-0 3xl:gap-0",
          )}
        >
          {COMMUNICATION_PREFERENCE_DETAILS.map((preference) => {
            const checked = state.communicationPreferences[preference.key]
            return (
              <div
                key={preference.key}
                className={cn(
                  "flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between",
                  cardLayoutMode === "grid" &&
                    "3xl:border-[#1F1F1F] 3xl:border-b last:3xl:border-b-0 odd:3xl:border-r",
                )}
              >
                <div className="pr-2">
                  <p className="font-medium text-foreground">{preference.label}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{preference.description}</p>
                </div>
                <Switch
                  checked={checked}
                  onCheckedChange={(enabled) => toggleCommunicationPreference(preference.key, enabled)}
                  aria-label={`${checked ? "Disable" : "Enable"} ${preference.label}`}
                  className="mt-0.5 data-[state=checked]:bg-[#F7931A]"
                />
              </div>
            )
          })}
        </div>
        <p className="mt-4 text-xs text-muted-foreground leading-relaxed 3xl:col-span-2">
          Account security notices, including new-device access alerts and login codes, are always sent when needed.
          Unsubscribe buttons in emails update these same preferences.
        </p>
      </div>
    </div>
  )

  useEffect(() => {
    function onWalkthroughSettingsTab(e: Event) {
      const tab = (e as CustomEvent<{ tab?: SettingsTab }>).detail?.tab
      if (tab && Object.prototype.hasOwnProperty.call(SETTINGS_TAB_SLUGS, tab)) {
        setSettingsTab(tab)
      }
    }
    window.addEventListener("bitbudget-walkthrough-settings-tab", onWalkthroughSettingsTab)
    return () => window.removeEventListener("bitbudget-walkthrough-settings-tab", onWalkthroughSettingsTab)
  }, [])

  const generalSection = (
    <div
      className={settingsSectionClass(
        cardLayoutMode,
        "tablet:grid-cols-2 lg:grid-cols-3 3xl:grid-cols-4",
      )}
    >
      <SettingsSetupGuideSection layoutMode={cardLayoutMode} />
      {/* Plan / Tier */}
      <div
        className={settingsSlotClass(
          cardLayoutMode,
          "p-6 bg-[#0D0D0D] rounded-2xl min-w-0 lg:col-span-1 3xl:col-start-3 3xl:row-start-1",
        )}
      >
        <div className="flex items-center gap-3 mb-4">
          <div
            className={`p-2 rounded-lg ${
              effectiveTier === "free" ? "bg-[#333]/50" : "bg-[#F7931A]/20"
            }`}
          >
            <Crown
              className={`h-5 w-5 ${
                effectiveTier === "free" ? "text-muted-foreground" : "text-[#F7931A]"
              }`}
            />
          </div>
          <h3 className="text-lg font-semibold text-foreground">Plan</h3>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <span
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold ${
              effectiveTier === "free"
                ? "bg-[#1A1A1A] text-muted-foreground border border-[#333]"
                : "bg-[#F7931A]/15 text-[#F7931A] border border-[#F7931A]/30"
            }`}
          >
            {effectiveTier === "premium" && (
              <>
                <Crown className="h-4 w-4" />
                Premium
              </>
            )}
            {effectiveTier === "premium-trial" && "Premium trial"}
            {effectiveTier === "free" && "Free"}
          </span>
          {hasPremiumFeatures && (
            <span className="text-sm text-muted-foreground">
              Bank sync, receipt inbox, and SMS alerts
              {effectiveTier === "premium-trial" ? " (trial limits apply)" : ""}.
            </span>
          )}
        </div>
      </div>

      {/* Income */}
      <div
        className={settingsSlotClass(
          cardLayoutMode,
          "p-6 bg-[#0D0D0D] rounded-2xl min-w-0 3xl:col-start-1 3xl:row-start-1",
        )}
      >
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

      <div
        className={settingsSlotClass(
          cardLayoutMode,
          "min-w-0 tablet:col-span-2 lg:col-span-1 3xl:col-start-4 3xl:row-start-1 3xl:row-span-2 flex flex-col gap-6",
          "min-w-0 flex flex-col gap-6",
        )}
      >
        <SettingsReferralsCard />
      </div>

      {/* Opportunity cost + BTC display: premium-only (free users keep landing/onboarding defaults) */}
      {subscriptionTier === "premium" && (
        <div
          className={settingsSlotClass(
            cardLayoutMode,
            "flex flex-col gap-6 tablet:col-span-2 lg:col-span-3 3xl:col-span-4",
            "flex flex-col gap-6",
          )}
        >
          <div className="p-4 md:p-6 bg-[#0D0D0D] rounded-2xl min-w-0">
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
        </div>
      )}
    </div>
  )

  const savingsSection = (
    <div
      className={settingsSectionClass(cardLayoutMode, "lg:grid-cols-2 3xl:grid-cols-3")}
    >
      <SettingsPastGoalsCard />
      <div
        className={settingsSlotClass(
          cardLayoutMode,
          "min-w-0 lg:col-span-1 3xl:col-span-2 flex flex-col gap-6",
          "min-w-0 flex flex-col gap-6",
        )}
      >
        <SettingsSavingsCard layoutMode={cardLayoutMode} />
        <IncomeImporterCard />
      </div>
    </div>
  )

  const upgradeCtaClass =
    "inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-semibold bg-[#F7931A] text-[#0D0D0D] hover:bg-[#F7931A]/90 transition-colors shrink-0 w-full sm:w-auto"

  const integrationsSection = (
    <>
      {/* Receipt Inbox — free users see upgrade path; no API call until Premium */}
      <div className="p-6 bg-[#0D0D0D] rounded-2xl">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-lg bg-[#06B6D4]/10">
            <Mail className="h-5 w-5 text-[#06B6D4]" />
          </div>
          <h3 className="text-lg font-semibold text-foreground">Receipt Inbox</h3>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Forward receipts to your dedicated address and they&apos;ll be saved for your review later. We recommend adding this address to your contacts.
        </p>
        {!hasPremiumFeatures ? (
          <div className="flex flex-col gap-4">
            <div className="rounded-xl border border-[#333] bg-[#1A1A1A] px-4 py-3">
              <p className="text-sm font-medium text-foreground mb-1">Premium feature</p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Upgrade to get a private forwarding address.
              </p>
            </div>
            <button type="button" onClick={() => setUpgradeModalFeature("receipt_inbox")} className={upgradeCtaClass}>
              <Crown className="h-4 w-4" />
              Upgrade to unlock receipt inbox
            </button>
          </div>
        ) : receiptInboxError ? (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3">
            <p className="text-sm text-red-200 mb-3">{receiptInboxError}</p>
            <button
              type="button"
              onClick={() => setReceiptInboxRetryKey(k => k + 1)}
              className="text-sm font-medium text-[#F7931A] hover:underline"
            >
              Try again
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2 rounded-xl border border-[#333] bg-[#1A1A1A] px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">Inbound address</p>
                <p className="font-mono text-base text-foreground break-all">
                  {receiptInboxLoading ? "Generating…" : receiptInboxAddress ?? "—"}
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
        )}
      </div>

      {/* Connections — visible on all plans; free tier opens upgrade flow */}
      <div className="p-6 bg-[#0D0D0D] rounded-2xl" data-walkthrough="settings-connections">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-lg bg-[#F7931A]/20">
            <Building2 className="h-5 w-5 text-[#F7931A]" />
          </div>
          <h3 className="text-lg font-semibold text-foreground">Connections</h3>
        </div>
        <p className="text-sm text-muted-foreground mb-6">
          {refereePendingBankLink && !hasPremiumFeatures
            ? "Connect your bank to activate your referral premium trial. See Referrals above for details."
            : "Connect your accounts to automatically import transactions. Premium unlocks bank sync, SMS capture, and connected email scanning."}
        </p>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-4 p-4 rounded-xl border border-[#333] bg-[#1A1A1A]">
            <div className="flex items-start gap-3">
              <Building2 className="h-5 w-5 text-[#F7931A] shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="font-medium text-foreground">Bank sync (Plaid)</p>
                <p className="text-sm text-muted-foreground">
                  Link your bank or credit card to import transactions automatically.
                </p>
              </div>
            </div>
            <PlaidConnectionsSection
              canConnect={hasPremiumFeatures || refereePendingBankLink}
            />
            {!(hasPremiumFeatures || refereePendingBankLink) ? (
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-end gap-3">
                <button type="button" onClick={() => setUpgradeModalFeature("plaid")} className={upgradeCtaClass}>
                  <Crown className="h-4 w-4" />
                  Upgrade to connect
                </button>
              </div>
            ) : null}
          </div>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-4 rounded-xl border border-[#333] bg-[#1A1A1A]">
            <div className="flex items-start gap-3 min-w-0">
              <Smartphone className="h-5 w-5 text-[#F7931A] shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-foreground">SMS alerts</p>
                <p className="text-sm text-muted-foreground">
                  Forward your bank&apos;s transaction SMS to a dedicated number to capture spending. Contact support for your personal forwarding number once you&apos;re on Premium.
                </p>
              </div>
            </div>
            {!hasPremiumFeatures && (
              <button type="button" onClick={() => setUpgradeModalFeature("sms")} className={upgradeCtaClass}>
                <Crown className="h-4 w-4" />
                Upgrade for SMS
              </button>
            )}
          </div>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-4 rounded-xl border border-[#333] bg-[#1A1A1A]">
            <div className="flex items-start gap-3 min-w-0">
              <Mail className="h-5 w-5 text-[#F7931A] shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-foreground">Connected email</p>
                <p className="text-sm text-muted-foreground">
                  Connect Gmail or Outlook to scan for receipts from known senders. Coming soon for Premium.
                </p>
              </div>
            </div>
            {!hasPremiumFeatures && (
              <button type="button" onClick={() => setUpgradeModalFeature("email_scan")} className={upgradeCtaClass}>
                <Crown className="h-4 w-4" />
                Upgrade for email scan
              </button>
            )}
          </div>
        </div>
      </div>

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
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={importLoading}
            className="flex items-center justify-center gap-2 py-3 px-6 bg-[#1A1A1A] text-foreground rounded-xl text-sm font-medium hover:bg-[#222] transition-colors border border-[#333] disabled:opacity-70 disabled:cursor-not-allowed"
          >
            {importLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {importOpen ? "Importing…" : "Parsing…"}
              </>
            ) : (
              <>
                <Upload className="h-4 w-4" />
                Choose CSV File
              </>
            )}
          </button>
          {importResult?.success && (
            <div className="flex items-center gap-2 rounded-lg bg-green-500/10 border border-green-500/20 px-4 py-3 text-sm text-green-600 dark:text-green-400">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span>
                {importResult.imported} transaction{importResult.imported !== 1 ? "s" : ""} imported
                {importResult.duplicates > 0 ? `, ${importResult.duplicates} duplicate${importResult.duplicates !== 1 ? "s" : ""} skipped` : ""}
                {importResult.skipped > 0 ? `, ${importResult.skipped} skipped` : ""}.
              </span>
            </div>
          )}
          {importResult?.success === false && (
            <div className="flex items-center gap-2 rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-600 dark:text-red-400">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>Import failed: {importResult.error}</span>
            </div>
          )}
        </div>
      </div>
    </>
  )

  const budgetingRulesSection = (
    <div className="p-6 bg-[#0D0D0D] rounded-2xl min-w-0 w-full max-w-full">
      <h3 className="text-lg font-semibold text-foreground">Budgeting rules</h3>
      <p className="mt-2 text-sm text-muted-foreground max-w-2xl">
        Map payee spellings so imports stay consistent, tag transactions for filtering, and schedule
        recurring rebalances or income distributions.
      </p>
      <div className="mt-6 flex flex-col gap-6">
        <PayeeMappingsSettings embedded />
        <SettingsTagsCard />
        <RecurringRulesSettings />
      </div>
    </div>
  )

  const dataSection = (
    <div className={settingsSectionClass(cardLayoutMode, "lg:grid-cols-2 3xl:grid-cols-3")}>
      <div
        className={settingsSlotClass(
          cardLayoutMode,
          "p-6 bg-[#0D0D0D] rounded-2xl min-w-0 lg:col-span-2 3xl:col-span-3",
        )}
      >
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-lg bg-[#8B5CF6]/10">
            <Shield className="h-5 w-5 text-[#8B5CF6]" />
          </div>
          <h3 className="text-lg font-semibold text-foreground">Privacy & Security</h3>
        </div>
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted-foreground">
            Your sensitive transaction data (payees, descriptions) is encrypted end-to-end.
            Only you can decrypt it with your passphrase or Nostr key.
          </p>
          <div className="flex items-center gap-2 mt-2">
            <div className="w-2 h-2 rounded-full bg-[#22C55E]" />
            <span className="text-xs text-[#22C55E]">Encryption active</span>
          </div>
        </div>
      </div>

      <div className={settingsSlotClass(cardLayoutMode, "p-6 bg-[#0D0D0D] rounded-2xl min-w-0 lg:col-span-1")}>
        <h3 className="text-lg font-semibold text-foreground mb-3">Data Summary</h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label className="text-muted-foreground text-xs uppercase tracking-wider">Envelopes</Label>
            <p className="text-lg font-semibold text-foreground">{state.envelopes.length}</p>
          </div>
          <div>
            <Label className="text-muted-foreground text-xs uppercase tracking-wider">Transactions</Label>
            <p className="text-lg font-semibold text-foreground">{dataTxnCount}</p>
            {!historyReady && (
              <p className="text-[11px] text-muted-foreground mt-1">Full count updates when sync completes.</p>
            )}
          </div>
        </div>
      </div>

      <div
        className={settingsSlotClass(
          cardLayoutMode,
          "p-6 bg-[#0D0D0D] rounded-2xl min-w-0 lg:col-span-2 3xl:col-span-3 border border-[#1F1F1F]",
        )}
      >
        <h3 className="text-lg font-semibold text-foreground mb-2">Own your data</h3>
        <p className="text-sm text-muted-foreground mb-6">
          Export, clean up duplicates, or permanently remove your data.
        </p>
        <div className={settingsInnerSectionClass(cardLayoutMode, "lg:grid-cols-2 3xl:grid-cols-3")}>
          <div className={settingsSlotClass(cardLayoutMode, "min-w-0 lg:col-span-1 3xl:order-3")}>
            <div className="rounded-xl border border-[#1F1F1F] bg-[#111] p-4 h-full">
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2 rounded-lg bg-[#3B82F6]/10">
                  <Download className="h-5 w-5 text-[#3B82F6]" />
                </div>
                <h4 className="text-base font-semibold text-foreground">Export transactions</h4>
              </div>
              <p className="text-sm text-muted-foreground mb-4">
                Export your active transactions as a CSV. For a filtered export, use{" "}
                <button
                  type="button"
                  onClick={() => navigateTo("transactions")}
                  className="text-[#F7931A] hover:underline font-medium"
                >
                  Transactions
                </button>
                .
              </p>
              <button
                type="button"
                onClick={handleExportTransactions}
                disabled={activeTransactions.length === 0}
                className="flex w-full sm:w-auto items-center justify-center gap-2 py-3 px-6 bg-[#1A1A1A] text-foreground rounded-xl text-sm font-medium hover:bg-[#222] transition-colors border border-[#333] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Download className="h-4 w-4" />
                Download
              </button>
            </div>
          </div>

          <div
            className={settingsSlotClass(
              cardLayoutMode,
              "min-w-0 lg:col-span-1 3xl:order-2 [&>div]:rounded-xl [&>div]:border [&>div]:border-[#1F1F1F]",
            )}
          >
            <DuplicateCleanupCard />
          </div>

          <div
            className={settingsSlotClass(
              cardLayoutMode,
              "min-w-0 lg:col-span-2 3xl:col-span-1 3xl:order-1 rounded-xl border border-red-500/20 bg-[#111] p-4",
              "min-w-0 rounded-xl border border-red-500/20 bg-[#111] p-4",
            )}
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 rounded-lg bg-red-500/10">
                <Trash2 className="h-5 w-5 text-red-500" />
              </div>
              <h4 className="text-base font-semibold text-foreground">Danger Zone</h4>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              Permanently delete all {dataTxnCount} transaction{dataTxnCount !== 1 ? "s" : ""} and{" "}
              {state.envelopes.length} envelope{state.envelopes.length !== 1 ? "s" : ""}. This cannot be undone.
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
        </div>
      </div>

      <div
        id="settings-linked-sign-in"
        className={settingsSlotClass(cardLayoutMode, "min-w-0 lg:col-span-2 3xl:col-span-3")}
      >
        <LinkedSignInMethods
          providerGridClassName={
            cardLayoutMode === "grid"
              ? "grid gap-3 sm:grid-cols-2 lg:grid-cols-2 3xl:grid-cols-4"
              : "flex flex-col gap-3"
          }
        />
      </div>
    </div>
  )

  return (
    <div className="flex min-w-0 w-full max-w-full flex-col gap-6">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <h2 className="text-2xl font-bold text-foreground">Settings</h2>
        <SettingsLayoutModeToggle mode={cardLayoutMode} onChange={setCardLayoutMode} />
      </div>
      <SettingsSetupGuideDrawer />
      <SettingsLayout activeTab={settingsTab} onSelectTab={selectSettingsTab}>
          {settingsTab === "general" && generalSection}
          {settingsTab === "communications" && communicationsSection}
          {settingsTab === "savings" && savingsSection}
          {settingsTab === "integrations" && integrationsSection}
          {settingsTab === "payees" && budgetingRulesSection}
          {settingsTab === "data" && dataSection}
      </SettingsLayout>

      <UpgradeModal
        key={upgradeModalFeature ?? "closed"}
        feature={upgradeModalFeature ?? "plaid"}
        open={upgradeModalFeature !== null}
        onClose={() => setUpgradeModalFeature(null)}
      />

      <CSVImportDialog
        open={importOpen}
        onOpenChange={(open) => {
          setImportOpen(open)
          if (!open) setImportLoading(false)
        }}
        file={importFile}
        dedupExistingTransactions={state.transactions}
        onImportComplete={refreshData}
        onImportResult={(result) =>
          setImportResult({
            success: true,
            imported: result.imported,
            skipped: result.skipped,
            duplicates: result.duplicates,
          })
        }
        onDone={() => {}}
        onRequestAllocations={() => {
          setImportOpen(false)
          navigateTo("envelopes", undefined, { openAllocations: true })
        }}
        onTryAnotherFile={() => {
          setImportOpen(false)
          setImportFile(null)
          setTimeout(() => fileRef.current?.click(), 0)
        }}
        onLoadingChange={setImportLoading}
        onImportError={handleImportError}
        encryptFn={encryptForStorage}
        makeDedupeKeyComputer={makeImportDedupeKeyComputer}
      />
    </div>
  )
}
