"use client"

export type WalletAssetGroup = "monitor" | "signer" | "blake2b" | "advanced"
export type WalletAssetCacheResult = {
  status: "disabled" | "unavailable" | "partial"
  group: WalletAssetGroup
  cachedAssets: number
}
export type WalletAssetCacheRequest = {
  enabled: boolean
  reason: "opt-in" | "demand"
}

const GROUPS: readonly string[] = ["monitor", "signer", "blake2b", "advanced"]

export async function cacheWalletAssets(
  group: WalletAssetGroup,
  request: WalletAssetCacheRequest,
): Promise<WalletAssetCacheResult> {
  const unavailable: WalletAssetCacheResult = { status: "unavailable", group, cachedAssets: 0 }
  if (request?.enabled !== true) return { status: "disabled", group, cachedAssets: 0 }
  if (!GROUPS.includes(group) || !["opt-in", "demand"].includes(request.reason)) return unavailable
  if (typeof window === "undefined" || typeof navigator === "undefined" ||
    !window.isSecureContext || !("serviceWorker" in navigator) || typeof MessageChannel === "undefined") return unavailable
  try {
    const worker = navigator.serviceWorker.controller
    if (!worker || worker.scriptURL !== new URL("/sw.js", window.location.origin).href) return unavailable
    return await new Promise<WalletAssetCacheResult>((resolve) => {
      const channel = new MessageChannel()
      const finish = (result: WalletAssetCacheResult) => {
        clearTimeout(timer)
        channel.port1.close()
        channel.port2.close()
        resolve(result)
      }
      const timer = setTimeout(() => finish(unavailable), 60000)
      channel.port1.onmessageerror = () => finish(unavailable)
      channel.port1.onmessage = (event: MessageEvent<unknown>) => {
        const result = event.data as Partial<WalletAssetCacheResult> | null
        if (result?.group === group && result.status === "partial" && Number.isSafeInteger(result.cachedAssets) &&
          result.cachedAssets! > 0 && result.cachedAssets! <= 64) {
          finish({ status: "partial", group, cachedAssets: result.cachedAssets! })
        } else {
          finish(unavailable)
        }
      }
      try {
        worker.postMessage({ type: "wallet-assets-cache", group, reason: request.reason }, [channel.port2])
      } catch {
        finish(unavailable)
      }
    })
  } catch {
    return unavailable
  }
}
