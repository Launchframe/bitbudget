"use client"

import { Component, useSyncExternalStore, type ReactNode } from "react"
import dynamic from "next/dynamic"
import { useApp } from "@/lib/app-context"
import {
  getWalletFeaturePreference,
  shouldLoadWalletFeature,
  subscribeWalletFeaturePreference,
} from "@/lib/wallet-feature-preference"

const WalletEntry = dynamic(() => import("@/components/wallet/wallet-entry"), {
  ssr: false,
  loading: () => <p role="status" className="p-6 text-sm text-muted-foreground">Loading wallet…</p>,
})

class WalletLoadBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <section className="rounded-2xl border border-border bg-card p-6" role="alert">
        <h2 className="font-semibold">Wallet could not load</h2>
        <p className="mt-2 text-sm text-muted-foreground">Check your connection and reload to try again. Your saved wallet data has not been removed.</p>
        <button type="button" onClick={() => window.location.reload()} className="mt-4 rounded-xl bg-[#F7931A] px-4 py-2 font-semibold text-black">Reload</button>
      </section>
    )
  }
}

export function WalletFeatureHost({ children }: { children: ReactNode }) {
  const { currentUserId, currentPage, state, loading, encryption } = useApp()
  const remembered = useSyncExternalStore(
    subscribeWalletFeaturePreference,
    () => getWalletFeaturePreference(currentUserId),
    () => false,
  )
  const requested = currentPage === "wallet"
  const load = shouldLoadWalletFeature({
    userId: currentUserId,
    bitcoinEnabled: state.opportunityCostEnabled,
    accountReady: !loading,
    privacyReady: encryption.ready && !encryption.needsPinUnlock,
    requested,
    remembered,
  })

  return (
    <>
      {load && currentUserId ? (
        <WalletLoadBoundary key={currentUserId}>
          <WalletEntry userId={currentUserId} visible={requested} />
        </WalletLoadBoundary>
      ) : null}
      {!requested ? children : !load ? <p role="status" className="p-6 text-sm text-muted-foreground">This page is not available. Return to Home to continue.</p> : null}
    </>
  )
}
