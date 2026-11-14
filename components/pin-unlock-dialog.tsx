"use client"

import { useState } from "react"
import { BitbudgetLogo } from "@/components/bitbudget-logo"
import { useApp } from "@/lib/app-context"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { AlertCircle, Lock, LogOut, ShieldAlert } from "lucide-react"
import {
  deriveKeyFromPin,
  decryptPrivacyKey,
  encryptPrivacyKey,
  generatePrivacyKey,
  generateSalt,
  hexToUint8,
  uint8ToHex,
} from "@/lib/crypto"
import { clearPrivacyKeyCache } from "@/lib/privacy-key-storage"
import { ENCRYPTION_RESET_CONFIRM, type EncryptionResetMode } from "@/lib/encryption-reset"

interface PinUnlockDialogProps {
  encryptedPrivacyKey: string
  privacyKeySalt: string
  onUnlock: (privacyKey: Uint8Array) => void
  onLogout?: () => void
  /** After a destructive reset, show passphrase setup instead of unlock. */
  needsPassphraseSetup?: boolean
  onPassphraseSetupComplete?: (privacyKey: Uint8Array) => void
  onDestructiveResetComplete?: () => void
  clearLocalTransactionCache?: () => Promise<void>
}

export function PinUnlockDialog({
  encryptedPrivacyKey,
  privacyKeySalt,
  onUnlock,
  onLogout,
  needsPassphraseSetup = false,
  onPassphraseSetupComplete,
  onDestructiveResetComplete,
  clearLocalTransactionCache,
}: PinUnlockDialogProps) {
  const { state } = useApp()

  if (needsPassphraseSetup) {
    return (
      <PassphraseSetupPanel
        opportunityCostEnabled={state.opportunityCostEnabled}
        onComplete={onPassphraseSetupComplete}
        onLogout={onLogout}
      />
    )
  }

  return (
    <UnlockPanel
      opportunityCostEnabled={state.opportunityCostEnabled}
      encryptedPrivacyKey={encryptedPrivacyKey}
      privacyKeySalt={privacyKeySalt}
      onUnlock={onUnlock}
      onLogout={onLogout}
      onDestructiveResetComplete={onDestructiveResetComplete}
      clearLocalTransactionCache={clearLocalTransactionCache}
    />
  )
}

function UnlockPanel({
  opportunityCostEnabled,
  encryptedPrivacyKey,
  privacyKeySalt,
  onUnlock,
  onLogout,
  onDestructiveResetComplete,
  clearLocalTransactionCache,
}: {
  opportunityCostEnabled: boolean
  encryptedPrivacyKey: string
  privacyKeySalt: string
  onUnlock: (privacyKey: Uint8Array) => void
  onLogout?: () => void
  onDestructiveResetComplete?: () => void
  clearLocalTransactionCache?: () => Promise<void>
}) {
  const [pin, setPin] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  const [showReset, setShowReset] = useState(false)

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
        <BitbudgetLogo variant={opportunityCostEnabled ? "btc" : "vanilla"} />

        <div className="w-full bg-[#0D0D0D] rounded-2xl p-8">
          <div className="flex flex-col items-center gap-4 mb-6">
            <div className="p-4 rounded-full bg-[#F7931A]/10">
              <Lock className="h-8 w-8 text-[#F7931A]" />
            </div>
            <h2 className="text-xl font-bold text-foreground">Welcome back</h2>
            <p className="text-sm text-muted-foreground text-center">
              This account already has encrypted data. Enter the{" "}
              <strong className="font-medium text-foreground">BitBudget passphrase</strong> you chose when you
              secured your data — not your Google, Apple, or email password.
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
              <Label className="text-muted-foreground text-xs uppercase tracking-wider">
                BitBudget passphrase
              </Label>
              <Input
                type="password"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
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

          <button
            type="button"
            onClick={() => setShowReset((v) => !v)}
            className="mt-4 w-full text-center text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
          >
            {showReset ? "Hide reset options" : "Forgot passphrase?"}
          </button>

          {showReset && (
            <DestructiveResetPanel
              clearLocalTransactionCache={clearLocalTransactionCache}
              onComplete={onDestructiveResetComplete}
            />
          )}
        </div>

        {onLogout && (
          <button
            type="button"
            onClick={onLogout}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <LogOut className="h-4 w-4" />
            Sign out &amp; switch account
          </button>
        )}

        <p className="text-xs text-muted-foreground text-center max-w-sm">
          Your data is encrypted end-to-end. This passphrase never leaves your device.
        </p>
      </div>
    </div>
  )
}

function DestructiveResetPanel({
  clearLocalTransactionCache,
  onComplete,
}: {
  clearLocalTransactionCache?: () => Promise<void>
  onComplete?: () => void
}) {
  const [mode, setMode] = useState<EncryptionResetMode>("encrypted_data")
  const [confirmText, setConfirmText] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function runReset() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch("/api/user/encryption/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, confirm: ENCRYPTION_RESET_CONFIRM }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        setError(data.error || "Could not reset. Try again.")
        return
      }
      try {
        clearPrivacyKeyCache()
      } catch {
        /* ignore */
      }
      try {
        await clearLocalTransactionCache?.()
      } catch {
        /* ignore */
      }
      onComplete?.()
    } catch {
      setError("Could not reach the server. Check your connection.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-4 flex flex-col gap-3 rounded-xl border border-red-500/30 bg-red-500/5 p-4">
      <div className="flex items-start gap-2">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-red-300">Forgot passphrase? (danger zone)</p>
          <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
            We cannot recover your old passphrase. Resetting deletes payees and notes on existing transactions
            forever, then lets you choose a new BitBudget passphrase.
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="min-w-0 text-muted-foreground">
          {mode === "encrypted_data"
            ? "Clear encrypted data only (keep envelopes)"
            : "Clear all data (fresh start — envelopes gone too)"}
        </span>
        <Switch
          checked={mode === "all_data"}
          onCheckedChange={(on) => setMode(on ? "all_data" : "encrypted_data")}
          aria-label="Clear all budgeting data for a fresh start"
        />
      </div>

      <label className="flex flex-col gap-2 text-xs text-muted-foreground">
        Type {ENCRYPTION_RESET_CONFIRM} to confirm
        <Input
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          placeholder={ENCRYPTION_RESET_CONFIRM}
          className="bg-[#1A1A1A] border-[#333] font-mono text-foreground"
          autoComplete="off"
        />
      </label>

      {error && <p className="text-xs text-red-400">{error}</p>}

      <button
        type="button"
        disabled={busy || confirmText !== ENCRYPTION_RESET_CONFIRM}
        onClick={() => void runReset()}
        className="w-full rounded-xl border border-red-500/40 bg-red-500/15 py-2.5 text-sm font-semibold text-red-300 hover:bg-red-500/25 disabled:opacity-50"
      >
        {busy ? "Resetting…" : mode === "all_data" ? "Reset and clear all data" : "Reset and clear encrypted data"}
      </button>
    </div>
  )
}

function PassphraseSetupPanel({
  opportunityCostEnabled,
  onComplete,
  onLogout,
}: {
  opportunityCostEnabled: boolean
  onComplete?: (privacyKey: Uint8Array) => void
  onLogout?: () => void
}) {
  const [pin, setPin] = useState("")
  const [pinConfirm, setPinConfirm] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (pin.length < 4) {
      setError("Use at least 4 characters.")
      return
    }
    if (pin !== pinConfirm) {
      setError("Passphrases do not match.")
      return
    }
    setBusy(true)
    try {
      const salt = generateSalt()
      const derivedKey = await deriveKeyFromPin(pin, salt)
      const privacyKey = generatePrivacyKey()
      const encrypted = await encryptPrivacyKey(privacyKey, derivedKey)
      const res = await fetch("/api/user/encryption", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          encryptedPrivacyKey: JSON.stringify(encrypted),
          privacyKeySalt: uint8ToHex(salt),
        }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string }
      if (!res.ok) {
        setError(
          data.code === "ENCRYPTION_ALREADY_CONFIGURED"
            ? "This account already has encryption again. Unlock with your passphrase."
            : data.error || "Could not save your new passphrase.",
        )
        return
      }
      onComplete?.(privacyKey)
    } catch {
      setError("Could not set up encryption. Try again.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-sm flex flex-col items-center gap-8">
        <BitbudgetLogo variant={opportunityCostEnabled ? "btc" : "vanilla"} />
        <div className="w-full bg-[#0D0D0D] rounded-2xl p-8">
          <div className="flex flex-col items-center gap-4 mb-6">
            <div className="p-4 rounded-full bg-[#F7931A]/10">
              <Lock className="h-8 w-8 text-[#F7931A]" />
            </div>
            <h2 className="text-xl font-bold text-foreground">Choose a new passphrase</h2>
            <p className="text-sm text-muted-foreground text-center">
              Create a BitBudget passphrase to encrypt new private data. This is not your Google or email password.{" "}
              <strong className="font-medium text-foreground">If you lose it, encrypted details cannot be recovered.</strong>
            </p>
          </div>
          <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label className="text-muted-foreground text-xs uppercase tracking-wider">New passphrase</Label>
              <Input
                type="password"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                placeholder="At least 4 characters"
                className="bg-[#1A1A1A] border-[#333] text-foreground placeholder:text-[#555]"
                minLength={4}
                autoFocus
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label className="text-muted-foreground text-xs uppercase tracking-wider">Confirm passphrase</Label>
              <Input
                type="password"
                value={pinConfirm}
                onChange={(e) => setPinConfirm(e.target.value)}
                placeholder="Re-enter your passphrase"
                className="bg-[#1A1A1A] border-[#333] text-foreground placeholder:text-[#555]"
              />
            </div>
            {error && <p className="text-sm text-red-400">{error}</p>}
            <button
              type="submit"
              disabled={busy || !pin || !pinConfirm}
              className="w-full py-3 bg-[#F7931A] text-[#0D0D0D] rounded-xl font-semibold text-sm hover:bg-[#F7931A]/90 transition-colors disabled:opacity-50"
            >
              {busy ? "Saving…" : "Save passphrase"}
            </button>
          </form>
        </div>
        {onLogout && (
          <button
            type="button"
            onClick={onLogout}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <LogOut className="h-4 w-4" />
            Sign out &amp; switch account
          </button>
        )}
      </div>
    </div>
  )
}
