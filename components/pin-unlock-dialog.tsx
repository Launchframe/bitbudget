"use client"

import { useState } from "react"
import { BitbudgetLogo } from "@/components/bitbudget-logo"
import { useApp } from "@/lib/app-context"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Lock, AlertCircle, LogOut } from "lucide-react"
import {
  deriveKeyFromPin,
  decryptPrivacyKey,
  hexToUint8,
} from "@/lib/crypto"

interface PinUnlockDialogProps {
  encryptedPrivacyKey: string
  privacyKeySalt: string
  onUnlock: (privacyKey: Uint8Array) => void
  onLogout?: () => void
}

export function PinUnlockDialog({ encryptedPrivacyKey, privacyKeySalt, onUnlock, onLogout }: PinUnlockDialogProps) {
  const { state } = useApp()
  const [pin, setPin] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!pin) return
    setError("")
    setLoading(true)

    try {
      const salt = hexToUint8(privacyKeySalt)
      const derivedKey = await deriveKeyFromPin(pin, salt)
      const encryptedData = JSON.parse(encryptedPrivacyKey) as { iv: string; ciphertext: string }
      const privacyKey = await decryptPrivacyKey(encryptedData, derivedKey)
      onUnlock(privacyKey)
    } catch {
      setError("Incorrect passphrase. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-sm flex flex-col items-center gap-8">
        <BitbudgetLogo variant={state.opportunityCostEnabled ? "btc" : "vanilla"} />

        <div className="w-full bg-[#0D0D0D] rounded-2xl p-8">
          <div className="flex flex-col items-center gap-4 mb-6">
            <div className="p-4 rounded-full bg-[#F7931A]/10">
              <Lock className="h-8 w-8 text-[#F7931A]" />
            </div>
            <h2 className="text-xl font-bold text-foreground">Unlock Your Data</h2>
            <p className="text-sm text-muted-foreground text-center">
              Enter the <strong className="font-medium text-foreground">BitBudget passphrase</strong> you chose when
              you secured your data — not your Google, Apple, or email password. You may be asked again later on this
              device.
            </p>
          </div>

          {error && (
            <div className="flex items-center gap-2 p-3 mb-4 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label className="text-muted-foreground text-xs uppercase tracking-wider">BitBudget passphrase</Label>
              <Input
                type="password"
                value={pin}
                onChange={e => setPin(e.target.value)}
                placeholder="BitBudget passphrase (not Google password)"
                className="bg-[#1A1A1A] border-[#333] text-foreground placeholder:text-[#555]"
                autoFocus
              />
            </div>
            <button
              type="submit"
              disabled={loading || !pin}
              className="w-full py-3 bg-[#F7931A] text-[#0D0D0D] rounded-xl font-semibold text-sm hover:bg-[#F7931A]/90 transition-colors disabled:opacity-50"
            >
              {loading ? "Decrypting..." : "Unlock"}
            </button>
          </form>
        </div>

        {onLogout && (
          <button
            onClick={onLogout}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <LogOut className="h-4 w-4" />
            Sign out &amp; switch account
          </button>
        )}

        <p className="text-xs text-muted-foreground text-center max-w-sm">
          Your data is encrypted end-to-end. This passphrase never leaves your device. If you signed in with Google and
          never finished setup, sign out and complete <span className="text-foreground">Secure Your Data</span> first —
          or reopen your shopping invite link after unlocking.
        </p>
      </div>
    </div>
  )
}
