"use client"

import { useEffect, useState, useSyncExternalStore } from "react"
import dynamic from "next/dynamic"
import { ArrowRight, Download, Fingerprint, ShieldCheck, Wallet, LockKeyhole } from "lucide-react"
import { Switch } from "@/components/ui/switch"
import {
  getWalletFeaturePreference,
  initializeWalletFeaturePreference,
  setWalletFeaturePreference,
  subscribeWalletFeaturePreference,
} from "@/lib/wallet-feature-preference"

const ExternalWallets = dynamic(
  () => import("@/components/bitcoin-wallets-card").then(module => module.BitcoinWalletsCard),
  { ssr: false, loading: () => <p role="status" className="text-sm text-muted-foreground">Loading external wallet tools…</p> },
)

const PublicDataTools = dynamic(() => import("@/components/wallet/public-data-tools"), {
  ssr: false,
  loading: () => <p role="status" className="text-sm text-muted-foreground">Loading local data tools…</p>,
})

const explanations = [
  { title: "Your device", description: "Your device holds one protected share. Device verification is required before signing.", Icon: Fingerprint },
  { title: "A separate co-signer", description: "BitBudget holds a second share. It cannot spend with that share alone.", Icon: ShieldCheck },
  { title: "Your recovery file", description: "An encrypted recovery share lets you recover with your device or the co-signer. One share alone cannot spend.", Icon: Download },
]

export default function WalletEntry({ userId, visible }: { userId: string; visible: boolean }) {
  const [view, setView] = useState<"overview" | "external" | "tools">("overview")
  const [preferenceError, setPreferenceError] = useState(false)
  const remembered = useSyncExternalStore(
    subscribeWalletFeaturePreference,
    () => getWalletFeaturePreference(userId),
    () => false,
  )

  useEffect(() => {
    if (visible) initializeWalletFeaturePreference(userId)
  }, [userId, visible])

  if (!visible) return null

  return (
    <div className="flex w-full min-w-0 flex-col gap-5" data-wallet-feature="entry">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="mb-2 flex items-center gap-2 text-sm text-[#F7931A]"><Wallet className="h-4 w-4" aria-hidden /> BitBudget Wallet</div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Your wallet. Both sides of the fork.</h1>
        </div>
        <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs text-amber-200">Research preview</span>
      </header>

      <nav aria-label="Wallet views" className="flex flex-wrap gap-2">
        <button type="button" aria-pressed={view === "overview"} onClick={() => setView("overview")} className={`rounded-full border px-4 py-2 text-sm ${view === "overview" ? "border-[#F7931A] text-[#F7931A]" : "border-border text-muted-foreground"}`}>Overview</button>
        <button type="button" aria-pressed={view === "external"} onClick={() => setView("external")} className={`rounded-full border px-4 py-2 text-sm ${view === "external" ? "border-[#F7931A] text-[#F7931A]" : "border-border text-muted-foreground"}`}>External wallet tracking</button>
        <button type="button" aria-pressed={view === "tools"} onClick={() => setView("tools")} className={`rounded-full border px-4 py-2 text-sm ${view === "tools" ? "border-[#F7931A] text-[#F7931A]" : "border-border text-muted-foreground"}`}>Public data tools</button>
      </nav>

      {view === "external" ? <ExternalWallets /> : view === "tools" ? <PublicDataTools /> : (
        <>
          <section className="overflow-hidden rounded-2xl border border-[#F7931A]/20 bg-[#0D0D0D] p-4 sm:p-6">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
              <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-2xl bg-[#F7931A]/10"><LockKeyhole className="h-12 w-12 text-[#F7931A]" aria-hidden /></div>
              <div className="min-w-0">
                <h2 className="text-xl font-semibold">Two shares to spend. One wallet to manage.</h2>
                <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">The wallet is designed to use any two of three shares. Connecting an indexer later adds that side’s activity to the same wallet; it does not create new keys.</p>
                <p role="status" className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-sm text-amber-200">Wallet creation, recovery and sending are not available in this build. Do not deposit funds into experimental wallet addresses. Existing external wallet tracking remains available separately.</p>
              </div>
            </div>
          </section>

          <div className="grid gap-3 md:grid-cols-3">
            {explanations.map(({ title, description, Icon }) => (
              <section key={title} className="min-w-0 rounded-2xl border border-border bg-[#0D0D0D] p-4 sm:p-5">
                <Icon className="mb-4 h-6 w-6 text-[#F7931A]" aria-hidden />
                <h3 className="font-semibold">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{description}</p>
              </section>
            ))}
          </div>

          <section className="rounded-2xl border border-border bg-[#0D0D0D] p-4 sm:p-6" aria-labelledby="wallet-connections-title">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Security</p>
            <h2 id="wallet-connections-title" className="mt-1 font-semibold">Connections</h2>
            <p className="mt-2 text-sm text-muted-foreground">Connect a Blake2b-compatible transaction indexer to watch and spend on that side of the fork.</p>
            <p className="mt-3 text-sm text-amber-200">Not connected. Indexer verification is not available in this build.</p>
          </section>
        </>
      )}

      <section className="flex flex-col gap-4 rounded-2xl border border-border bg-[#0D0D0D] p-4 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div className="min-w-0">
          <label htmlFor="wallet-remember" className="font-medium">Remember this wallet workspace</label>
          <p className="mt-1 text-sm text-muted-foreground">Keep the workspace enabled for this account on this browser. This never unlocks signing or sends a transaction.</p>
          {preferenceError ? <p role="alert" className="mt-2 text-sm text-red-300">Your browser could not save this preference.</p> : null}
        </div>
        <Switch id="wallet-remember" checked={remembered} onCheckedChange={enabled => setPreferenceError(!setWalletFeaturePreference(userId, enabled))} />
      </section>

      {view !== "external" ? <button type="button" onClick={() => setView("external")} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#F7931A] px-5 py-3 text-sm font-semibold text-black sm:w-fit">Open external wallet tracking <ArrowRight className="h-4 w-4" aria-hidden /></button> : null}
    </div>
  )
}
