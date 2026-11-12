export function clearWallets(userId: string): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.removeItem(`bitbudget-wallets-${userId}`)
  } catch {
    return
  }
}

export async function clearWalletDb(userId: string): Promise<void> {
  if (typeof indexedDB === "undefined") return
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(`bitbudget-wallets-${userId}`)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error("Close other BitBudget tabs to clear the external wallet cache."))
  })
}
