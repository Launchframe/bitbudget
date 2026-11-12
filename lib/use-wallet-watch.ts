"use client"

import { useSyncExternalStore } from "react"
import {
  getWalletWatchServerSnapshot,
  getWalletWatchSnapshot,
  subscribeWalletWatch,
  type WalletWatch,
} from "@/lib/wallet-watch-store"

/** Confirmed-sats watches stored in this browser. Empty during SSR. */
export function useWalletWatches(): readonly WalletWatch[] {
  return useSyncExternalStore(
    subscribeWalletWatch,
    getWalletWatchSnapshot,
    getWalletWatchServerSnapshot,
  )
}
