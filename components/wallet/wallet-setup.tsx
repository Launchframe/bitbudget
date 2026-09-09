"use client"

import { useCallback, useEffect, useRef, useState, type ComponentProps } from "react"
import Link from "next/link"
import { z } from "zod"
import { CheckCircle2, Download, Fingerprint, ShieldCheck, ArrowRight, Eye, EyeOff } from "lucide-react"
import { useApp } from "@/lib/app-context"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { PasskeyEncryptionError, walletPasskey } from "@/lib/wallet/browser-passkey"
import { WalletClientError } from "@/lib/wallet/client-http"
import { CreationWorkerClient } from "@/lib/wallet/creation-worker-client"
import { openWalletCustodyStore } from "@/lib/wallet/wallet-idb"
import { serializeRecoveryPackage, MAX_RECOVERY_FILE_CHARACTERS } from "@/lib/wallet/recovery-package"
import { decryptField, encryptField } from "@/lib/crypto"

const createdSchema = z.object({ walletId: z.string().uuid(), recoveryFile: z.string().max(MAX_RECOVERY_FILE_CHARACTERS) })
const verifiedSchema = z.object({ walletId: z.string().uuid(), verifiedAt: z.string().datetime() })
type Step = "intro" | "security" | "creating" | "recovery" | "success"

function WalletPasswordInput({ id, revealLabel, disabled, ...props }: Omit<ComponentProps<typeof Input>, "type" | "className"> & { id: string; revealLabel: string }) {
  const [revealed, setRevealed] = useState(false)
  const action = `${revealed ? "Hide" : "Show"} ${revealLabel}`
  return <div className="relative mt-2">
    <Input {...props} id={id} type={revealed ? "text" : "password"} disabled={disabled} className="pr-10" />
    <Button type="button" variant="ghost" size="icon" disabled={disabled} aria-label={action} aria-controls={id} title={action} onClick={() => setRevealed(value => !value)} className="absolute right-0 top-0 size-9 text-muted-foreground hover:text-foreground">
      {revealed ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
    </Button>
  </div>
}

function ShareIllustration() {
  return <svg viewBox="0 0 360 126" role="img" aria-label="Device, co-signer and recovery: any two shares can authorize a spend" className="mx-auto h-32 w-full max-w-lg text-[#F7931A]">
    <path d="M70 57H290" stroke="currentColor" strokeWidth="2" strokeDasharray="5 5" opacity=".4" />
    {[60, 180, 300].map(x => <circle key={x} cx={x} cy="57" r="33" fill="#1A1410" stroke="currentColor" strokeWidth="1.5" />)}
    <rect x="49" y="38" width="22" height="37" rx="4" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M56 68H64M170 43H190V69H170ZM173 51H187M173 61H187M290 40H305L311 46V74H290ZM305 40V47H311M295 57H306M295 64H306" fill="none" stroke="currentColor" strokeWidth="2" />
    <g fill="#a3a3a3" fontSize="12" textAnchor="middle"><text x="60" y="112">Your device</text><text x="180" y="112">Co-signer</text><text x="300" y="112">Recovery file</text></g>
  </svg>
}

function errorMessage(error: unknown) {
  const code = error instanceof WalletClientError ? error.code : "wallet-creation-failed"
  if (error instanceof PasskeyEncryptionError && error.reason === "browser-unavailable") return "Passkeys are unavailable in this browser or on this connection. Use an updated browser and a secure connection, or localhost for local setup."
  if (code === "passkey-encryption-unavailable") return "The selected passkey did not provide the encryption this wallet needs. A passkey that works for sign-in may not support wallet encryption. Try saving the passkey with your device instead of a password manager extension, where supported. You may need to temporarily turn off the extension’s passkey handling. Setup will not use weaker protection instead."
  if (code === "passkey-ceremony-failed") return "Device verification could not finish. Please try again."
  if (code === "privacy-key-unavailable") return "Unlock your BitBudget privacy key before creating a wallet. No wallet keys have been created."
  if (code === "setup-cancelled") return "Device verification was cancelled. You can try again when you’re ready."
  if (code === "credential-already-registered") return "A wallet passkey is already registered. Return to the wallet and try again using that passkey."
  if (code === "recovery-verification-failed" || code === "recovery-proof-rejected") return "The recovery file or password could not be verified for this wallet. Check both and try again."
  if (code === "device-share-unavailable") return "This wallet’s device share is not available in this browser. Do not create replacement keys for it. Use its recovery flow instead."
  return "The wallet operation could not finish. Your stored wallet and recovery data have not been removed. Check your connection and retry."
}

export default function WalletSetup({ userId, network, hasCredential, resumeWalletId, onClose, onChanged }: {
  userId: string
  network: "signet" | "testnet4" | "regtest"
  hasCredential: boolean
  resumeWalletId?: string
  onClose: () => void
  onChanged: () => void
}) {
  const { getPrivacyKey } = useApp()
  const encryptName = useCallback(async (value: string) => {
    const key = getPrivacyKey()
    if (!key) throw new WalletClientError("privacy-key-unavailable")
    try { return await encryptField(value, key) } finally { key.fill(0) }
  }, [getPrivacyKey])
  const [step, setStep] = useState<Step>(resumeWalletId ? "recovery" : "intro")
  const [name, setName] = useState("My wallet")
  const [password, setPassword] = useState("")
  const [confirmation, setConfirmation] = useState("")
  const [walletId, setWalletId] = useState<string | null>(resumeWalletId ?? null)
  const [recoveryFile, setRecoveryFile] = useState("")
  const [file, setFile] = useState<File | null>(null)
  const [downloaded, setDownloaded] = useState(false)
  const [pending, setPending] = useState(Boolean(resumeWalletId))
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState("")
  const [error, setError] = useState("")
  const [errorCode, setErrorCode] = useState("")
  const [errorDetail, setErrorDetail] = useState("")
  const [confirmClose, setConfirmClose] = useState(false)
  const client = useRef<CreationWorkerClient | null>(null)
  const abort = useRef<AbortController | null>(null)
  const savedId = useRef<string | null>(resumeWalletId ?? null)
  const alive = useRef(true)
  const nameTouched = useRef(false)
  const draftKey = `bitbudget-wallet-${userId}-draft`

  useEffect(() => {
    alive.current = true
    return () => { alive.current = false; abort.current?.abort(); client.current?.dispose() }
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const key = getPrivacyKey()
      try {
        const saved = sessionStorage.getItem(draftKey)
        if (saved && key) {
          const draft = JSON.parse(saved)
          if (draft.userId === userId && typeof draft.encryptedName === "string") {
            const label = await decryptField(draft.encryptedName, key)
            if (!cancelled && !nameTouched.current && label.length <= 60) setName(label)
          }
        }
      } catch {}
      finally { key?.fill(0) }
      if (resumeWalletId) {
        const store = await openWalletCustodyStore(userId)
        try {
          const record = await store.getWallet(resumeWalletId)
          if (!record) throw new WalletClientError("device-share-unavailable")
          if (!cancelled) { setRecoveryFile(serializeRecoveryPackage(record.envelopes.recoveryShare)); setPending(Boolean(record.pendingCreation)) }
        } finally { store.close() }
      }
    })().catch(error => { if (!cancelled) setError(errorMessage(error)) })
    return () => { cancelled = true }
  }, [draftKey, getPrivacyKey, resumeWalletId, userId])

  useEffect(() => {
    if (!nameTouched.current) return
    const timer = setTimeout(() => {
      void encryptName(name).then(encryptedName => {
        if (alive.current) sessionStorage.setItem(draftKey, JSON.stringify({ userId, encryptedName }))
      }).catch(() => undefined)
    }, 400)
    return () => clearTimeout(timer)
  }, [name, draftKey, encryptName, userId])

  function showError(error: unknown) {
    setError(errorMessage(error))
    setErrorCode(error instanceof WalletClientError ? error.code : "wallet-operation-failed")
    setErrorDetail(error instanceof PasskeyEncryptionError ? error.reason : "")
  }

  function worker() { return client.current ??= new CreationWorkerClient() }

  async function create() {
    if (busy || !name.trim() || name.length > 60 || password.length < 12 || password !== confirmation) return
    const recoveryPassword = password
    setPassword(""); setConfirmation(""); setBusy(true); setError(""); setStep("creating"); setProgress("Confirm on your device")
    abort.current = new AbortController()
    let prf: Uint8Array<ArrayBuffer> | undefined
    let privacyKey: Uint8Array<ArrayBuffer> | undefined
    try {
      const encryptedName = await encryptName(name.trim())
      const credential = await walletPasskey(network, hasCredential, abort.current.signal)
      prf = credential.prfOutput
      if (!alive.current) return
      const unlocked = getPrivacyKey()
      if (!unlocked) throw new WalletClientError("privacy-key-unavailable")
      privacyKey = Uint8Array.from(unlocked)
      unlocked.fill(0)
      const result = createdSchema.parse(await worker().run({ type: "create", input: { userId, network, credentialId: credential.credentialId, prf, privacyKey, grantId: credential.grantId, password: recoveryPassword, encryptedName } }, event => {
        if (!alive.current) return
        setProgress(({ creating: "Creating your wallet", securing: "Encrypting your device and recovery shares", saved: "Device share saved", finishing: "Saving the co-signer share" })[event.stage])
        if (event.stage === "saved" && event.walletId) { savedId.current = event.walletId; setWalletId(event.walletId); setPending(true) }
      }))
      if (!alive.current) return
      setWalletId(result.walletId); savedId.current = result.walletId; setRecoveryFile(result.recoveryFile); setPending(false); setStep("recovery"); onChanged()
    } catch (error) {
      if (alive.current) {
        if (!savedId.current) { setPassword(recoveryPassword); setConfirmation(recoveryPassword) }
        showError(error); setStep(savedId.current ? "recovery" : "security"); onChanged()
      }
    } finally { if (prf?.byteLength) prf.fill(0); if (privacyKey?.byteLength) privacyKey.fill(0); if (alive.current) setBusy(false) }
  }

  async function resume() {
    if (!walletId || busy) return
    setBusy(true); setError(""); abort.current = new AbortController()
    let prf: Uint8Array<ArrayBuffer> | undefined
    try {
      const credential = await walletPasskey(network, true, abort.current.signal, walletId)
      prf = credential.prfOutput
      if (!alive.current) return
      const result = createdSchema.parse(await worker().run({ type: "resume", input: { userId, walletId, credentialId: credential.credentialId, prf } }))
      if (alive.current) { setRecoveryFile(result.recoveryFile); setPending(false); onChanged() }
    } catch (error) { if (alive.current) showError(error) }
    finally { if (prf?.byteLength) prf.fill(0); if (alive.current) setBusy(false) }
  }

  function download() {
    const url = URL.createObjectURL(new Blob([recoveryFile], { type: "application/json" }))
    const link = document.createElement("a")
    link.href = url; link.download = `bitbudget-recovery-${walletId}.json`; link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    setDownloaded(true)
  }

  async function verify() {
    if (!walletId || !file || busy || password.length < 12 || file.size > MAX_RECOVERY_FILE_CHARACTERS) return
    const recoveryPassword = password
    setPassword(""); setBusy(true); setError(""); abort.current = new AbortController()
    let prf: Uint8Array<ArrayBuffer> | undefined
    try {
      const contents = await file.text()
      const credential = await walletPasskey(network, true, abort.current.signal, walletId)
      prf = credential.prfOutput
      if (!alive.current) return
      verifiedSchema.parse(await worker().run({ type: "verify", input: { userId, walletId, credentialId: credential.credentialId, prf, password: recoveryPassword, file: contents } }))
      if (alive.current) { setStep("success"); setFile(null); setRecoveryFile(""); try { sessionStorage.removeItem(draftKey) } catch {} onChanged() }
    } catch (error) { if (alive.current) showError(error) }
    finally { if (prf?.byteLength) prf.fill(0); if (alive.current) setBusy(false) }
  }

  return <section className="min-w-0 rounded-2xl border border-[#F7931A]/25 bg-[#0D0D0D] p-4 sm:p-6" data-wallet-setup="true" data-wallet-asset-group="bitbudget-wallet-assets:signer:v1">
    <div className="mb-5 flex items-center justify-between gap-3"><span className="text-xs uppercase tracking-wide text-[#F7931A]">{network} · test coins only</span><Button variant="ghost" disabled={busy} onClick={() => step === "success" ? onClose() : setConfirmClose(true)}>Close</Button></div>
    <ShareIllustration />
    <p className="mt-4 text-sm"><Link href="/faq#passkey-compatibility" target="_blank" rel="noopener noreferrer" prefetch={false} className="text-[#F7931A] underline underline-offset-4">Passkey compatibility and wallet FAQ (opens in a new tab)</Link></p>
    {step === "intro" ? <div className="mt-5 space-y-4">
      <h2 className="text-2xl font-semibold">Your Bitcoin, with a recovery plan</h2>
      <p className="text-sm leading-relaxed text-muted-foreground">Any two of three shares can authorize a spend. Your device holds one, BitBudget holds a separate co-signing share, and you keep a password-protected recovery file.</p>
      <p className="text-sm leading-relaxed text-muted-foreground">This is a browser wallet, not a hardware wallet. During setup and recovery, this browser temporarily handles two shares, so use a trusted device. BitBudget learns your account’s co-signing activity and protocol metadata, but cannot spend using its share alone. Biometrics stay on your device; your device may use its PIN instead.</p>
      <p className="text-sm leading-relaxed text-muted-foreground">One wallet supports both sides of the fork. Connecting a compatible indexer later enables activity on that side without changing your keys. No indexer is needed to set up your wallet.</p>
      <Button onClick={() => setStep("security")} className="w-full bg-[#F7931A] text-black sm:w-auto">Continue to protection <ArrowRight className="ml-2 h-4 w-4" /></Button>
    </div> : null}
    {step === "security" ? <div className="mt-5 space-y-4">
      <h2 className="text-xl font-semibold">Protect your wallet</h2>
      <div><Label htmlFor="wallet-name">Wallet name</Label><Input id="wallet-name" value={name} maxLength={60} onChange={event => { nameTouched.current = true; setName(event.target.value) }} className="mt-2" /></div>
      <p className="text-sm text-muted-foreground">Choose a recovery password before creating keys so your recovery share is encrypted immediately. Keep it separately from the downloaded file.</p>
      <div><Label htmlFor="wallet-recovery-password">Recovery password (at least 12 characters)</Label><WalletPasswordInput id="wallet-recovery-password" revealLabel="recovery password" autoComplete="new-password" value={password} maxLength={1024} onChange={event => setPassword(event.target.value)} /></div>
      <div><Label htmlFor="wallet-recovery-confirm">Confirm recovery password</Label><WalletPasswordInput id="wallet-recovery-confirm" revealLabel="recovery password confirmation" autoComplete="new-password" value={confirmation} maxLength={1024} onChange={event => setConfirmation(event.target.value)} /></div>
      <p className="text-xs text-muted-foreground">Your device may ask for verification more than once. Unsupported passkey encryption will stop setup; there is no password-only device fallback.</p>
      <Button onClick={() => { void create() }} disabled={busy || !name.trim() || password.length < 12 || password !== confirmation} className="w-full bg-[#F7931A] text-black sm:w-auto"><Fingerprint className="mr-2 h-4 w-4" />Create wallet with passkey</Button>
    </div> : null}
    {step === "creating" ? <div className="py-6 text-center"><ShieldCheck className="mx-auto mb-3 h-8 w-8 text-[#F7931A] motion-safe:animate-pulse" /><h2 className="text-xl font-semibold">Creating your wallet</h2><p role="status" className="mt-2 text-sm text-muted-foreground">{progress}</p><p className="mt-3 text-xs text-muted-foreground">Keep this tab open while your shares are protected and saved.</p></div> : null}
    {step === "recovery" ? <div className="mt-5 space-y-4">
      <h2 className="text-xl font-semibold">Save and verify your recovery file</h2>
      <p className="text-sm leading-relaxed text-muted-foreground">Save this file somewhere separate from this device. Its recovery share is encrypted, but the file also includes public wallet identifiers, so keep the whole file private. With its password, it works with either your device share or BitBudget’s co-signer. It cannot spend alone or recover if both other shares become unavailable.</p>
      {pending ? <Button onClick={() => { void resume() }} disabled={busy}>Finish saving wallet</Button> : <>
        <Button onClick={download} disabled={!recoveryFile || busy} variant="outline"><Download className="mr-2 h-4 w-4" />{downloaded ? "Download recovery file again" : "Download recovery file"}</Button>
        <div><Label htmlFor="wallet-recovery-file">Reopen the saved recovery file</Label><Input id="wallet-recovery-file" type="file" accept=".json,application/json" disabled={busy} className="mt-2" onChange={event => {
          const selected = event.target.files?.[0] ?? null
          if (selected && selected.size > MAX_RECOVERY_FILE_CHARACTERS) { setError("That file is too large to be a wallet recovery file."); setFile(null) } else { setFile(selected); setError("") }
        }} /></div>
        <div><Label htmlFor="wallet-verify-password">Recovery password</Label><WalletPasswordInput id="wallet-verify-password" revealLabel="recovery password" autoComplete="current-password" disabled={busy} value={password} maxLength={1024} onChange={event => setPassword(event.target.value)} /></div>
        <Button onClick={() => { void verify() }} disabled={busy || !file || password.length < 12} className="w-full bg-[#F7931A] text-black sm:w-auto">{busy ? "Verifying recovery…" : "Verify recovery file"}</Button>
      </>}
      <p className="text-xs text-muted-foreground">Downloading alone does not finish setup. Verification checks the recovered share and proves it works with your protected device share.</p>
    </div> : null}
    {step === "success" ? <div className="mt-5 space-y-4 text-center"><CheckCircle2 className="mx-auto h-12 w-12 text-green-500" /><h2 className="text-2xl font-semibold">Wallet created. Recovery verified.</h2><p className="text-sm text-muted-foreground">Your device share and encrypted recovery file were verified together. Keep the file and its password safe.</p><p className="text-sm text-amber-200">This test-network preview does not enable sending or fundable receive addresses yet.</p><Button onClick={onClose} className="bg-[#F7931A] text-black">Open wallet</Button></div> : null}
    {error ? <div role="alert" data-wallet-error-code={errorCode} data-wallet-error-detail={errorDetail || undefined} className="mt-4 rounded-xl border border-red-500/25 bg-red-500/5 p-3 text-sm text-red-300"><p>{error}</p>{errorDetail ? <p className="mt-2 text-xs">Support code: {errorDetail}</p> : null}</div> : null}
    <AlertDialog open={confirmClose} onOpenChange={setConfirmClose}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Leave wallet setup?</AlertDialogTitle><AlertDialogDescription>{walletId ? "Your protected shares remain on this device. You can return to complete recovery verification. No wallet data will be deleted." : "Your recovery password is not saved. You will need to enter it again when you return."}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Stay here</AlertDialogCancel><AlertDialogAction onClick={onClose}>Leave setup</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </section>
}
