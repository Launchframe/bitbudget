"use client"

import { useState, useEffect, useRef } from "react"
import { signIn } from "next-auth/react"
import { useRouter } from "next/navigation"
import { BitbudgetLogo } from "@/components/bitbudget-logo"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Github, Mail, KeyRound, Zap, AlertCircle, ArrowLeft } from "lucide-react"

type AuthMethod = "email" | "nostr" | null
type EmailStep = "enter-email" | "enter-code"

export default function AuthPage() {
  const router = useRouter()
  const [method, setMethod] = useState<AuthMethod>(null)
  const [email, setEmail] = useState("")
  const [code, setCode] = useState("")
  const [emailStep, setEmailStep] = useState<EmailStep>("enter-email")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  const [nostrAvailable, setNostrAvailable] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const codeInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    document.cookie = "bitbudget_visited=1; path=/; max-age=31536000; SameSite=Lax"
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

  async function fetchNostrProfile(pubkey: string): Promise<{ name?: string; picture?: string }> {
    const RELAYS = [
      "wss://relay.damus.io",
      "wss://relay.nostr.band",
      "wss://nos.lol",
      "wss://relay.primal.net",
    ]
    try {
      const { SimplePool } = await import("nostr-tools/pool")
      const pool = new SimplePool()
      const event = await pool.get(RELAYS, { kinds: [0], authors: [pubkey] })
      pool.close(RELAYS)
      if (!event?.content) return {}
      const meta = JSON.parse(event.content) as Record<string, string>
      return {
        name: meta.display_name || meta.name || undefined,
        picture: meta.picture || undefined,
      }
    } catch {
      return {}
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

      const event = {
        kind: 27235,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ["u", window.location.origin],
          ["method", "login"],
        ],
        content: "BitBudget Login",
        pubkey,
      }

      const signed = await nostrExt.signEvent(event)

      const profile = await fetchNostrProfile(pubkey)

      const result = await signIn("nostr", {
        pubkey,
        event: JSON.stringify(signed),
        profileName: profile.name || "",
        profileImage: profile.picture || "",
        redirect: false,
      })

      if (result?.error) {
        setError(`Nostr authentication failed: ${result.error}`)
      } else {
        router.push("/")
        router.refresh()
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      const lower = msg.toLowerCase()

      if (lower.includes("nos2x")) {
        setError("nos2x needs to be set up first. Open the nos2x extension, add or import a private key, then try logging in again.")
      } else if (lower.includes("keys.band")) {
        setError("Keys.band needs an active account. Open the Keys.band extension, select or create an account, then try logging in again.")
      } else if (lower.includes("alby")) {
        setError("Alby needs to be set up first. Open the Alby extension, make sure you're logged in with a Nostr key, then try logging in again.")
      } else if (lower.includes("reject") || lower.includes("denied") || lower.includes("cancel") || lower.includes("no private key") || lower.includes("not available")) {
        setError("Your Nostr extension isn't ready. Open it, make sure you have a key set up, then try logging in again.")
      } else {
        setError(`Nostr login failed: ${msg}`)
      }
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
    setError("")
    setCooldown(0)
  }

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-md flex flex-col items-center gap-8">
        <BitbudgetLogo />

        <div className="w-full bg-[#0D0D0D] rounded-2xl p-8">
          <h1 className="text-2xl font-bold text-foreground text-center mb-2">
            Welcome to BitBudget
          </h1>
          <p className="text-muted-foreground text-sm text-center mb-8">
            Sign in or create an account
          </p>

          {error && (
            <div className="flex items-center gap-2 p-3 mb-6 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
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
                  To sign in with Nostr you need a browser extension that manages your keys.
                  Install one of these, create or import your keypair, then reload this page.
                </p>

                <div className="flex flex-col gap-3 w-full">
                  {([
                    { name: "Alby", href: "https://getalby.com/", img: "https://www.satlantis.io/images/alby-logo.svg" },
                    { name: "Keys.band", href: "https://keys.band/", img: "https://www.satlantis.io/images/keys-band-logo.png" },
                    { name: "nos2x", href: "https://nostrapps.com/nos2x", img: "https://www.satlantis.io/images/nos2x-logo.png" },
                  ] as const).map((ext) => (
                    <a
                      key={ext.name}
                      href={ext.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-4 w-full py-3 px-4 bg-[#1A1A1A] rounded-xl text-sm hover:bg-[#222] transition-colors border border-[#333]"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={ext.img} alt={ext.name} className="h-8 w-8 rounded-md object-contain" />
                      <div className="flex flex-col">
                        <span className="font-semibold text-foreground">{ext.name}</span>
                        <span className="text-xs text-muted-foreground">{ext.href.replace(/^https?:\/\//, "").replace(/\/$/, "")}</span>
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
              </div>
            </div>
          )}
        </div>

        <p className="text-xs text-muted-foreground text-center max-w-sm">
          Your data is encrypted end-to-end. BitBudget cannot read your transaction details.
        </p>
      </div>
    </div>
  )
}
