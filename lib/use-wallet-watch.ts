"use client"

import { useCallback, useSyncExternalStore } from "react"
import {
  getWalletWatchServerSnapshot,
  getWalletWatchSnapshot,
  subscribeWalletWatch,
  type WalletWatch,
} from "@/lib/wallet-watch-store"

/** Confirmed-sats watches for this signed-in user. Empty during SSR and when signed out. */
export function useWalletWatches(userId: string | null): readonly WalletWatch[] {
  const getSnapshot = useCallback(
    () => getWalletWatchSnapshot(userId),
    [userId],
  )
  return useSyncExternalStore(
    subscribeWalletWatch,
    getSnapshot,
    getWalletWatchServerSnapshot,
  )
}
