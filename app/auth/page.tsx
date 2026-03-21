"use client"

import { useState, useEffect, useRef } from "react"
import { signIn } from "next-auth/react"
import { useRouter } from "next/navigation"
import { BitbudgetLogo, type BitbudgetLogoVariant } from "@/components/bitbudget-logo"
import { DocumentFavicon } from "@/components/document-favicon"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Github, Mail, KeyRound, Zap, AlertCircle, ArrowLeft, HelpCircle, ChevronLeft, ChevronRight, X } from "lucide-react"
import {
  decodeNsec,
  signAuthEvent,
  fetchNostrProfile,
  buildAuthEventTemplate,
  setPendingNsec,
  setNsecOnboardingIntent,
} from "@/lib/nostr-local-signer"
import { debugLogger } from "@/lib/debug-logger"
import { usePlatform, type PlatformOS } from "@/lib/platform-context"

type AuthMethod = "email" | "nostr" | "nsec" | null

type SignerEntry = { name: string; href: string; img?: string; recommended?: boolean; note?: string }

function getSignersForPlatform(os: PlatformOS): SignerEntry[] {
  if (os === "android") {
    return [
      { name: "Alby on Firefox", href: "https://addons.mozilla.org/en-US/android/addon/alby/", img: "alby-logo.svg", note: "Requires Firefox for Android" },
      { name: "Amber", href: "https://zapstore.dev/apps/com.greenart7c3.nostrsigner", img: "amber.png", note: "Use nsec fallback below for web login" },
    ]
  }
  if (os === "ios") {
    return [
      { name: "Nostash", href: "https://apps.apple.com/us/app/nostash/id6744309333", img: "nostash-logo.webp", note: "Safari extension for NIP-07" },
    ]
  }
  return [
    { name: "keys.band", href: "https://keys.band/", img: "keys-band-logo.png", recommended: true },
    { name: "Alby", href: "https://getalby.com/", img: "alby-logo.svg" },
    { name: "nos2x", href: "https://nostrapps.com/nos2x", img: "nos2x-logo.png" },
  ]
}
type EmailStep = "enter-email" | "enter-code"

export default function AuthPage() {
  const router = useRouter()
  const platform = usePlatform()
  const [method, setMethod] = useState<AuthMethod>(null)
  const [email, setEmail] = useState("")
  const [code, setCode] = useState("")
  const [emailStep, setEmailStep] = useState<EmailStep>("enter-email")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  const [nostrAvailable, setNostrAvailable] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const [keysGuideOpen, setKeysGuideOpen] = useState(false)
  const [keysGuideStep, setKeysGuideStep] = useState(0)
  const [nsecValue, setNsecValue] = useState("")
  const codeInputRef = useRef<HTMLInputElement>(null)

  const [entryBranding, setEntryBranding] = useState<{
    favicon: string
    logo: BitbudgetLogoVariant
  }>({ favicon: "/icon-vanilla.svg", logo: "vanilla" })

  useEffect(() => {
    try {
      const btc = sessionStorage.getItem("onboardingSource") === "btc"
      setEntryBranding({
        favicon: btc ? "/icon.svg" : "/icon-vanilla.svg",
        logo: btc ? "btc" : "vanilla",
      })
    } catch {
      setEntryBranding({ favicon: "/icon-vanilla.svg", logo: "vanilla" })
    }
  }, [])

  useEffect(() => {
    if ("nostr" in window) {
      setNostrAvailable(true)
      return
    }
    const timer = setTimeout(() => {
      if ("nostr" in window) setNostrAvailable(true)
    }, 500)
    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    function handlePageShow(e: PageTransitionEvent) {
      if (e.persisted) setLoading(false)
    }
    window.addEventListener("pageshow", handlePageShow)
    return () => window.removeEventListener("pageshow", handlePageShow)
  }, [])

  useEffect(() => {
    if (cooldown <= 0) return
    const timer = setTimeout(() => setCooldown(c => c - 1), 1000)
    return () => clearTimeout(timer)
  }, [cooldown])

  async function handleSendCode(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim()) return
    setError("")
    setLoading(true)

    try {
      const res = await fetch("/api/auth/send-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || "Failed to send code")
        return
      }
      setEmailStep("enter-code")
      setCode("")
      setCooldown(60)
      setTimeout(() => codeInputRef.current?.focus(), 100)
    } catch {
      setError("Something went wrong. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  async function handleVerifyCode(e: React.FormEvent) {
    e.preventDefault()
    if (!code.trim()) return
    setError("")
    setLoading(true)

    try {
      const result = await signIn("email-code", {
        email: email.trim(),
        code: code.trim(),
        redirect: false,
      })

      if (result?.error) {
        setError("Invalid or expired code. Please try again.")
      } else {
        router.push("/")
        router.refresh()
      }
    } catch {
      setError("Something went wrong. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  async function handleResendCode() {
    if (cooldown > 0) return
    setError("")
    setLoading(true)

    try {
      const res = await fetch("/api/auth/send-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || "Failed to resend code")
        return
      }
      setCooldown(60)
      setCode("")
    } catch {
      setError("Failed to resend code")
    } finally {
      setLoading(false)
    }
  }

  async function handleNostrLogin() {
    setError("")
    setLoading(true)

    try {
      const nostrExt = (window as unknown as { nostr?: {
        getPublicKey: () => Promise<string>
        signEvent: (event: Record<string, unknown>) => Promise<Record<string, unknown>>
      } }).nostr

      if (!nostrExt) {
        setError("No Nostr extension found. Install nos2x or similar.")
        setLoading(false)
        return
      }

      const pubkey = await nostrExt.getPublicKey()
      const event = { ...buildAuthEventTemplate(window.location.origin), pubkey }
      const signed = await nostrExt.signEvent(event)

      const profile = await fetchNostrProfile(pubkey)

      const result = await signIn("nostr", {
        pubkey,
        event: JSON.stringify(signed),
        profileName: profile.name ?? "",
        profileImage: profile.image ?? "",
        redirect: false,
      })

      if (result?.error) {
        setError(`Nostr authentication failed: ${result.error}`)
      } else {
        try { sessionStorage.setItem("nostr-login", pubkey) } catch { /* SSR guard */ }
        router.push("/")
        router.refresh()
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      const lower = msg.toLowerCase()
      debugLogger.log("Nostr login error:", msg)

      // Check for user-rejected / denied before extension-name checks. Extensions
      // like keys.band include their name in both "no account" AND "rejected" errors,
      // so the rejection keywords must be matched first.
      const isRejection =
        lower.includes("reject") ||
        lower.includes("denied") ||
        lower.includes("cancel")
      const isNoAccount =
        lower.includes("no private key") ||
        lower.includes("not available") ||
        lower.includes("no accounts")

      if (isRejection) {
        setError("You declined the request. Click Continue with Nostr again when you\u2019re ready to approve it, or go into your extension settings and approve bitbudget.io")
      } else if (lower.includes("nos2x")) {
        setError("nos2x needs to be set up first. Open the nos2x extension, add or import a private key, then try logging in again.")
      } else if (lower.includes("keys.band")) {
        setError("keys.band-setup")
      } else if (lower.includes("alby")) {
        setError("Alby needs to be set up first. Open the Alby extension, make sure you're logged in with a Nostr key, then try logging in again.")
      } else if (isNoAccount) {
        setError("Your Nostr extension isn't ready. Open it, make sure you have a key set up, then try logging in again.")
      } else {
        setError(`Nostr login failed: ${msg}`)
      }
    } finally {
      setLoading(false)
    }
  }

  async function handleNsecLogin(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    setLoading(true)
    try {
      const { secretKey, pubkey } = decodeNsec(nsecValue)
      const signed = signAuthEvent(secretKey, window.location.origin)
      const profile = await fetchNostrProfile(pubkey)
      const result = await signIn("nostr", {
        pubkey,
        event: JSON.stringify(signed),
        profileName: profile.name ?? "",
        profileImage: profile.image ?? "",
        redirect: false,
      })
      if (result?.error) {
        setError(`Nostr authentication failed: ${result.error}`)
        return
      }
      setNsecValue("")
      // Bridge to onboarding security step (in-memory key + session intent flag). Must not block navigation
      // if helpers fail after sign-in already succeeded.
      try {
        setPendingNsec(secretKey)
        setNsecOnboardingIntent()
      } catch {
        /* continue — user is authenticated */
      }
      router.push("/")
      router.refresh()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg.startsWith("Invalid nsec") ? msg : `Sign-in failed: ${msg}`)
    } finally {
      setLoading(false)
    }
  }

  async function handleOAuth(provider: string) {
    setLoading(true)
    await signIn(provider, { callbackUrl: "/" })
  }

  function resetToMethodPicker() {
    setMethod(null)
    setEmailStep("enter-email")
    setCode("")
    setNsecValue("")
    setError("")
    setCooldown(0)
  }

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6">
      <DocumentFavicon href={entryBranding.favicon} />
      <div className="w-full max-w-md flex flex-col items-center gap-8">
        <BitbudgetLogo variant={entryBranding.logo} />

        <div className="w-full bg-[#0D0D0D] rounded-2xl p-8">
          <h1 className="text-2xl font-bold text-foreground text-center mb-2">
            Welcome to BitBudget
          </h1>
          <p className="text-muted-foreground text-sm text-center mb-8">
            Sign in or create an account
          </p>

          {error && (
            <div className="flex items-start gap-2 p-3 mb-6 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              {error === "keys.band-setup" ? (
                <div className="flex flex-col gap-1.5 flex-1">
                  <span>keys.band needs an active account. Open the keys.band extension, select an account, and then try logging in again.</span>
                  <button
                    type="button"
                    onClick={() => { setKeysGuideStep(0); setKeysGuideOpen(true) }}
                    className="flex items-center gap-1 text-xs text-[#3B82F6] hover:text-[#60A5FA] transition-colors self-start"
                  >
                    <HelpCircle className="h-3.5 w-3.5" />
                    Show me how
                  </button>
                </div>
              ) : (
                <span>{error}</span>
              )}
            </div>
          )}

          {/* Method picker */}
          {!method && (
            <div className="flex flex-col gap-3">
              <button
                onClick={() => {
                  if (nostrAvailable) {
                    handleNostrLogin()
                  } else {
                    setMethod("nostr")
                  }
                }}
                disabled={loading}
                className="flex items-center justify-center gap-3 w-full py-3 px-4 bg-[#8B5CF6] text-white rounded-xl font-semibold text-sm hover:bg-[#8B5CF6]/90 transition-colors disabled:opacity-50"
              >
                <Zap className="h-5 w-5" />
                {nostrAvailable ? "Continue with Nostr" : "Continue with Nostr Extension"}
              </button>

              <button
                type="button"
                onClick={() => { setMethod("nsec"); setError("") }}
                disabled={loading}
                className="w-full py-2 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
              >
                Sign in with nsec (paste key)
              </button>

              <div className="flex items-center gap-4 my-2">
                <div className="flex-1 h-px bg-[#1F1F1F]" />
                <span className="text-xs text-muted-foreground">or continue with</span>
                <div className="flex-1 h-px bg-[#1F1F1F]" />
              </div>

              <button
                onClick={() => setMethod("email")}
                disabled={loading}
                className="flex items-center justify-center gap-3 w-full py-3 px-4 bg-[#1A1A1A] text-foreground rounded-xl font-semibold text-sm hover:bg-[#222] transition-colors border border-[#333] disabled:opacity-50"
              >
                <Mail className="h-4 w-4" />
                Email
              </button>

              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => handleOAuth("google")}
                  disabled={loading}
                  className="flex items-center justify-center gap-2 py-3 px-4 bg-[#1A1A1A] text-foreground rounded-xl text-sm hover:bg-[#222] transition-colors border border-[#333] disabled:opacity-50"
                >
                  <svg className="h-4 w-4" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                  </svg>
                  Google
                </button>
                <button
                  onClick={() => handleOAuth("github")}
                  disabled={loading}
                  className="flex items-center justify-center gap-2 py-3 px-4 bg-[#1A1A1A] text-foreground rounded-xl text-sm hover:bg-[#222] transition-colors border border-[#333] disabled:opacity-50"
                >
                  <Github className="h-4 w-4" />
                  GitHub
                </button>
              </div>
            </div>
          )}

          {/* Email flow: enter email */}
          {method === "email" && emailStep === "enter-email" && (
            <form onSubmit={handleSendCode} className="flex flex-col gap-4">
              <button
                type="button"
                onClick={resetToMethodPicker}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors self-start mb-2"
              >
                <ArrowLeft className="h-3 w-3" />
                Back to all options
              </button>

              <div className="flex flex-col gap-2">
                <Label className="text-muted-foreground text-xs uppercase tracking-wider">Email</Label>
                <Input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="bg-[#1A1A1A] border-[#333] text-foreground placeholder:text-[#555]"
                  required
                  autoFocus
                />
              </div>

              <button
                type="submit"
                disabled={loading || !email.trim()}
                className="w-full py-3 bg-[#F7931A] text-[#0D0D0D] rounded-xl font-semibold text-sm hover:bg-[#F7931A]/90 transition-colors disabled:opacity-50 mt-2"
              >
                {loading ? "Sending code..." : "Send Login Code"}
              </button>

              <p className="text-xs text-muted-foreground text-center">
                We&apos;ll send a 6-digit code to your email.
              </p>
            </form>
          )}

          {/* Email flow: enter code */}
          {method === "email" && emailStep === "enter-code" && (
            <form onSubmit={handleVerifyCode} className="flex flex-col gap-4">
              <button
                type="button"
                onClick={() => { setEmailStep("enter-email"); setCode(""); setError("") }}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors self-start mb-2"
              >
                <ArrowLeft className="h-3 w-3" />
                Use a different email
              </button>

              <div className="flex flex-col items-center gap-2 py-2">
                <Mail className="h-8 w-8 text-[#F7931A]" />
                <p className="text-sm text-foreground text-center">
                  Enter the 6-digit code sent to
                </p>
                <p className="text-sm font-medium text-foreground">{email}</p>
              </div>

              <div className="flex flex-col gap-2">
                <Input
                  ref={codeInputRef}
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  value={code}
                  onChange={e => setCode(e.target.value.replace(/\D/g, ""))}
                  placeholder="000000"
                  className="bg-[#1A1A1A] border-[#333] text-foreground placeholder:text-[#555] text-center text-2xl tracking-[0.3em] font-mono"
                  autoFocus
                />
              </div>

              <button
                type="submit"
                disabled={loading || code.length !== 6}
                className="w-full py-3 bg-[#F7931A] text-[#0D0D0D] rounded-xl font-semibold text-sm hover:bg-[#F7931A]/90 transition-colors disabled:opacity-50"
              >
                {loading ? "Verifying..." : "Continue"}
              </button>

              <button
                type="button"
                onClick={handleResendCode}
                disabled={loading || cooldown > 0}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
              >
                {cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend code"}
              </button>
            </form>
          )}

          {/* Nsec fallback: sign in with raw nsec */}
          {method === "nsec" && (
            <form onSubmit={handleNsecLogin} className="flex flex-col gap-4">
              <button
                type="button"
                onClick={() => { setMethod("nostr"); setNsecValue(""); setError("") }}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors self-start mb-2"
              >
                <ArrowLeft className="h-3 w-3" />
                Back
              </button>
              <div className="flex flex-col items-center gap-2 py-2">
                <KeyRound className="h-8 w-8 text-[#8B5CF6]" />
                <h3 className="text-lg font-semibold text-foreground">Sign in with your nsec</h3>
                <p className="text-xs text-muted-foreground text-center">
                  Your nsec never leaves your device. It stays in this browser tab until you set a PIN; then it is
                  encrypted and stored locally. Refreshing before then signs you out and you will need to sign in again.
                </p>
              </div>
              <div className="flex flex-col gap-2">
                <Label className="text-muted-foreground text-xs uppercase tracking-wider">Private key</Label>
                <Input
                  type="password"
                  value={nsecValue}
                  onChange={e => setNsecValue(e.target.value)}
                  placeholder="nsec1..."
                  className="bg-[#1A1A1A] border-[#333] text-foreground placeholder:text-[#555] text-sm"
                  autoComplete="off"
                  autoFocus
                />
              </div>
              <button
                type="submit"
                disabled={loading || !nsecValue.trim()}
                className="w-full py-3 bg-[#8B5CF6] text-white rounded-xl font-semibold text-sm hover:bg-[#8B5CF6]/90 transition-colors disabled:opacity-50"
              >
                {loading ? "Signing in..." : "Continue"}
              </button>
            </form>
          )}

          {/* Nostr extension not found */}
          {method === "nostr" && !nostrAvailable && (
            <div className="flex flex-col gap-4">
              <button
                type="button"
                onClick={resetToMethodPicker}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors self-start mb-2"
              >
                <ArrowLeft className="h-3 w-3" />
                Back to all options
              </button>

              <div className="flex flex-col items-center gap-4 py-4">
                <div className="p-4 rounded-full bg-[#8B5CF6]/10">
                  <KeyRound className="h-8 w-8 text-[#8B5CF6]" />
                </div>
                <h3 className="text-lg font-semibold text-foreground">No Nostr Extension Detected</h3>
                <p className="text-sm text-muted-foreground text-center leading-relaxed">
                  To sign in with Nostr you need a browser extension or app that manages your keys.
                  Install one of these, create or import your keypair, then reload this page.
                </p>

                <div className="flex flex-col gap-3 w-full">
                  {getSignersForPlatform(platform.os).map((ext) => (
                    <a
                      key={ext.name}
                      href={ext.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-4 w-full py-3 px-4 bg-[#1A1A1A] rounded-xl text-sm hover:bg-[#222] transition-colors border border-[#333]"
                    >
                      {ext.img ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img src={`/img/${ext.img}`} alt={ext.name} className="h-8 w-8 shrink-0 rounded-md object-contain" />
                      ) : (
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[#8B5CF6]/15" aria-hidden>
                          <KeyRound className="h-4 w-4 text-[#8B5CF6]" />
                        </span>
                      )}
                      <div className="flex flex-col">
                        <span className="font-semibold text-foreground">{ext.name}</span>
                        <span className="text-xs text-muted-foreground">{new URL(ext.href).host || ext.href.split(/\.\w+$/)[0].replace(/^https?:\/\//, "").replace(/\/$/, "")}</span>
                        {ext.recommended && <span className="text-xs text-btc-orange">Recommended</span>}
                        {ext.note && <span className="text-xs text-muted-foreground mt-0.5">{ext.note}</span>}
                      </div>
                    </a>
                  ))}
                </div>

                <button
                  onClick={() => window.location.reload()}
                  className="w-full py-3 bg-[#8B5CF6] text-white rounded-xl font-semibold text-sm hover:bg-[#8B5CF6]/90 transition-colors mt-2"
                >
                  I&apos;ve Installed It — Reload
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setError("")
                    setNsecValue("")
                    setMethod("nsec")
                  }}
                  className="w-full py-2.5 mt-2 text-sm text-muted-foreground hover:text-foreground transition-colors border border-[#333] rounded-xl"
                >
                  Or sign in with your nsec
                </button>
              </div>
            </div>
          )}
        </div>

        <p className="text-xs text-muted-foreground text-center max-w-sm">
          Payee and notes are encrypted end-to-end. BitBudget can still see some transaction metadata, including date,
          amount, and certain categories or tags.
        </p>
      </div>

      {keysGuideOpen && (() => {
        const steps = [
          { img: "/onboarding/keys-band/1-add-account.jpeg", title: "Add an account", desc: "Open keys.band from your browser's extensions, and click to add your first account." },
          { img: "/onboarding/keys-band/2-credentials.jpeg", title: "Set up your key", desc: 'Generate a new key, or enter an existing key and choose "Add Account".' },
          { img: "/onboarding/keys-band/3-select-account.jpeg", title: "Select your account", desc: "Now that you have a key loaded, open the Accounts selector and choose your account." },
          { img: "/onboarding/keys-band/4-confirm-account-selected.jpeg", title: "You\u2019re ready!", desc: "With your account selected, come back here and try logging in again." },
        ]
        const s = steps[keysGuideStep]
        const isLast = keysGuideStep === steps.length - 1
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setKeysGuideOpen(false)}>
            <div className="relative bg-[#0D0D0D] border border-[#1F1F1F] rounded-2xl max-w-md w-full overflow-hidden" onClick={e => e.stopPropagation()}>
              <button
                type="button"
                onClick={() => setKeysGuideOpen(false)}
                className="absolute top-3 right-3 z-10 p-1.5 rounded-lg bg-[#1A1A1A] text-muted-foreground hover:text-foreground transition-colors"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>

              <div className="px-4 pt-4 pb-2">
                <p className="text-xs font-medium text-[#3B82F6] bg-[#3B82F6]/10 rounded-lg px-3 py-2 text-center">
                  Follow these steps in your keys.band browser extension
                </p>
              </div>

              <div className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={s.img} alt={s.title} className="w-full aspect-[4/3] object-contain bg-[#1A1A1A]" />
                <span className="absolute top-2 left-2 text-[10px] font-medium bg-black/60 text-white/70 px-2 py-0.5 rounded-full">
                  Screenshot
                </span>
              </div>

              <div className="p-5 flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-muted-foreground">Step {keysGuideStep + 1} of {steps.length}</span>
                  <div className="flex gap-1 ml-auto">
                    {steps.map((_, i) => (
                      <div key={i} className={`h-1.5 rounded-full transition-colors ${i === keysGuideStep ? "w-4 bg-[#3B82F6]" : "w-1.5 bg-[#333]"}`} />
                    ))}
                  </div>
                </div>

                <h3 className="text-lg font-bold text-foreground">{s.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{s.desc}</p>

                <div className="flex gap-2 mt-1">
                  {keysGuideStep > 0 && (
                    <button
                      type="button"
                      onClick={() => setKeysGuideStep(keysGuideStep - 1)}
                      className="flex-1 py-2.5 bg-[#1A1A1A] text-foreground rounded-xl text-sm font-medium hover:bg-[#222] transition-colors border border-[#333] flex items-center justify-center gap-1"
                    >
                      <ChevronLeft className="h-4 w-4" /> Back
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      if (isLast) {
                        setKeysGuideOpen(false)
                      } else {
                        setKeysGuideStep(keysGuideStep + 1)
                      }
                    }}
                    className="flex-1 py-2.5 bg-[#3B82F6] text-white rounded-xl text-sm font-medium hover:bg-[#3B82F6]/90 transition-colors flex items-center justify-center gap-1"
                  >
                    {isLast ? "Got it" : <>Next <ChevronRight className="h-4 w-4" /></>}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
