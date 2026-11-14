"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { signIn } from "next-auth/react"
import { AlertCircle, CheckCircle2, Github, Loader2, Mail, Shield, Zap } from "lucide-react"
import { buildAuthEventTemplate, fetchNostrProfileWithRetry } from "@/lib/nostr-local-signer"
import type { LinkProvider, SignInMethods } from "@/lib/sign-in-methods"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

const EMPTY_METHODS: SignInMethods = {
  email: null,
  emailLinked: false,
  nostrPubkey: null,
  nostrLinked: false,
  oauthProviders: [],
}

function GoogleIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden>
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  )
}

function shortPubkey(pubkey: string | null) {
  return pubkey ? `${pubkey.slice(0, 10)}...${pubkey.slice(-6)}` : null
}

async function readJsonError(res: Response, fallback: string) {
  const data = (await res.json().catch(() => ({}))) as { error?: string }
  return data.error ?? fallback
}

export function LinkedSignInMethods({
  providerGridClassName = "flex flex-col gap-3",
}: {
  providerGridClassName?: string
}) {
  const [methods, setMethods] = useState<SignInMethods>(EMPTY_METHODS)
  const [loading, setLoading] = useState(true)
  const [action, setAction] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [email, setEmail] = useState("")
  const [code, setCode] = useState("")
  const [emailCodeSent, setEmailCodeSent] = useState(false)
  const [pendingPrivacyLink, setPendingPrivacyLink] = useState<"email" | LinkProvider | null>(null)

  const linkedOAuth = useMemo(() => new Set(methods.oauthProviders), [methods.oauthProviders])
  const isNostrOnly = methods.nostrLinked && !methods.emailLinked && methods.oauthProviders.length === 0

  const loadMethods = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/user/sign-in-methods")
      if (!res.ok) throw new Error(await readJsonError(res, "Failed to load sign-in methods"))
      const data = (await res.json()) as SignInMethods
      setMethods(data)
      setEmail(current => (data.email && !current ? data.email : current))
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load sign-in methods")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadMethods()
    window.addEventListener("pageshow", loadMethods)
    return () => window.removeEventListener("pageshow", loadMethods)
  }, [loadMethods])

  async function executeSendEmailCode() {
    setAction("email-code")
    setError(null)
    setSuccess(null)
    try {
      const res = await fetch("/api/auth/send-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      })
      if (!res.ok) throw new Error(await readJsonError(res, "Failed to send code"))
      setEmailCodeSent(true)
      setSuccess("Check your inbox for a 6-digit code.")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send code")
    } finally {
      setAction(null)
    }
  }

  function queuePrivacyLink(link: "email" | LinkProvider) {
    // Defer past form-submit / focus handling so the portaled overlay cannot paint above content on first mount.
    requestAnimationFrame(() => setPendingPrivacyLink(link))
  }

  async function sendEmailCode(e: React.FormEvent) {
    e.preventDefault()
    if (isNostrOnly) {
      queuePrivacyLink("email")
      return
    }
    await executeSendEmailCode()
  }

  async function linkEmail(e: React.FormEvent) {
    e.preventDefault()
    setAction("email-link")
    setError(null)
    setSuccess(null)
    try {
      const res = await fetch("/api/user/sign-in-methods", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method: "email", email, code }),
      })
      if (!res.ok) throw new Error(await readJsonError(res, "Failed to link email"))
      setCode("")
      setEmailCodeSent(false)
      setSuccess("Success! You can now log in with email.")
      await loadMethods()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to link email")
    } finally {
      setAction(null)
    }
  }

  async function linkNostr() {
    setAction("nostr")
    setError(null)
    setSuccess(null)
    try {
      const nostrExt = (window as unknown as {
        nostr?: {
          getPublicKey: () => Promise<string>
          signEvent: (event: Record<string, unknown>) => Promise<Record<string, unknown>>
        }
      }).nostr
      if (!nostrExt) throw new Error("No Nostr extension found.")

      const pubkey = await nostrExt.getPublicKey()
      const event = { ...buildAuthEventTemplate(window.location.origin), pubkey }
      const signed = await nostrExt.signEvent(event)
      const profile = await fetchNostrProfileWithRetry(pubkey)
      const res = await fetch("/api/user/sign-in-methods", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          method: "nostr",
          pubkey,
          event: JSON.stringify(signed),
          profileName: profile.name ?? "",
          profileImage: profile.image ?? "",
        }),
      })
      if (!res.ok) throw new Error(await readJsonError(res, "Failed to link Nostr"))
      setSuccess("Success! You can now log in with Nostr.")
      await loadMethods()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to link Nostr")
    } finally {
      setAction(null)
    }
  }

  async function linkOAuth(provider: LinkProvider) {
    if (isNostrOnly) {
      queuePrivacyLink(provider)
      return
    }
    await executeOAuthLink(provider)
  }

  async function executeOAuthLink(provider: LinkProvider) {
    setAction(provider)
    setError(null)
    setSuccess(null)
    try {
      await signIn(provider, { callbackUrl: "/#settings/data-security" })
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to link ${provider}`)
    } finally {
      setAction(null)
    }
  }

  async function continuePendingPrivacyLink() {
    const pending = pendingPrivacyLink
    setPendingPrivacyLink(null)
    if (!pending) return
    if (pending === "email") {
      await executeSendEmailCode()
      return
    }
    await executeOAuthLink(pending)
  }

  function methodRow({
    icon,
    title,
    description,
    connected,
    children,
  }: {
    icon: React.ReactNode
    title: string
    description: string
    connected: boolean
    children?: React.ReactNode
  }) {
    return (
      <div className="rounded-xl border border-[#1F1F1F] bg-[#111] p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex gap-3">
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#1A1A1A] text-muted-foreground">
              {icon}
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h4 className="text-sm font-semibold text-foreground">{title}</h4>
                {connected && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-xs font-medium text-success">
                    <CheckCircle2 className="h-3 w-3" />
                    Connected
                  </span>
                )}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{description}</p>
            </div>
          </div>
        </div>
        {children && <div className="mt-4">{children}</div>}
      </div>
    )
  }

  const oauthButtonClass =
    "inline-flex items-center justify-center gap-2 rounded-xl border border-[#333] bg-[#1A1A1A] px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-[#222] disabled:cursor-not-allowed disabled:opacity-50"

  return (
    <div className="p-6 bg-[#0D0D0D] rounded-2xl">
      <Dialog open={pendingPrivacyLink !== null} onOpenChange={(open) => {
        if (!open) setPendingPrivacyLink(null)
      }}>
        <DialogContent className="border-[#333] bg-[#0D0D0D] text-foreground">
          <DialogHeader>
            <DialogTitle>Linking another sign-in method will weaken your privacy</DialogTitle>
            <DialogDescription>
              Right now, BitBudget knows you only by your Nostr public key. If you link your email, or an email-based provider like Google or GitHub,
              BitBudget will store that account identifier alongside your npub so you can log in with either one.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-200">
            Proceeding will naturally weaken the privacy of your account by linking additional identifiers to it.
            Please consider these trade-offs before continuing.
          </div>
          <DialogFooter>
            <button
              type="button"
              onClick={() => setPendingPrivacyLink(null)}
              className="rounded-xl border border-[#333] bg-[#1A1A1A] px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-[#222]"
            >
              Nevermind
            </button>
            <button
              type="button"
              onClick={continuePendingPrivacyLink}
              className="rounded-xl bg-btc-orange px-4 py-2 text-sm font-semibold text-[#0D0D0D] transition-colors hover:bg-btc-orange/90"
            >
              I understand, continue
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="flex items-center gap-3 mb-4">
        <div className="p-2 rounded-lg bg-[#3B82F6]/10">
          <Shield className="h-5 w-5 text-[#3B82F6]" />
        </div>
        <div>
          <h3 className="text-lg font-semibold text-foreground">Linked sign-in methods</h3>
          <p className="text-sm text-muted-foreground">
            Add another way to access this account.
          </p>
        </div>
      </div>

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-400">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {success && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-success/20 bg-success/10 p-3 text-sm text-success">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{success}</span>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading sign-in methods...
        </div>
      ) : (
        <div className={providerGridClassName}>
          {methodRow({
            icon: <Mail className="h-4 w-4" />,
            title: "Email one-time code",
            description: methods.emailLinked ? methods.email ?? "Email sign-in is connected." : "Link an email address so you can sign in with a one-time code.",
            connected: methods.emailLinked,
            children: !methods.emailLinked && (
              <form className="flex flex-col gap-3" onSubmit={emailCodeSent ? linkEmail : sendEmailCode}>
                <Input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  aria-label="Email address to link"
                  disabled={emailCodeSent}
                  required
                />
                {emailCodeSent && (
                  <Input
                    value={code}
                    onChange={e => setCode(e.target.value)}
                    inputMode="numeric"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    placeholder="6-digit code"
                    aria-label="Email verification code"
                    required
                  />
                )}
                <button
                  type="submit"
                  disabled={action === "email-code" || action === "email-link"}
                  className={oauthButtonClass}
                >
                  {(action === "email-code" || action === "email-link") && <Loader2 className="h-4 w-4 animate-spin" />}
                  {emailCodeSent ? "Verify and link email" : "Send code"}
                </button>
              </form>
            ),
          })}

          {methodRow({
            icon: <Zap className="h-4 w-4" />,
            title: "Nostr",
            description: methods.nostrLinked ? `Linked key ${shortPubkey(methods.nostrPubkey)}` : "Link a Nostr key using your browser extension.",
            connected: methods.nostrLinked,
            children: !methods.nostrLinked && (
              <button type="button" onClick={linkNostr} disabled={action === "nostr"} className={oauthButtonClass}>
                {action === "nostr" && <Loader2 className="h-4 w-4 animate-spin" />}
                Link Nostr extension
              </button>
            ),
          })}

          {methodRow({
            icon: <GoogleIcon />,
            title: "Google",
            description: linkedOAuth.has("google") ? "Google sign-in is connected." : "Link your Google account from this signed-in session.",
            connected: linkedOAuth.has("google"),
            children: !linkedOAuth.has("google") && (
              <button type="button" onClick={() => linkOAuth("google")} disabled={action === "google"} className={oauthButtonClass}>
                {action === "google" && <Loader2 className="h-4 w-4 animate-spin" />}
                Link Google
              </button>
            ),
          })}

          {methodRow({
            icon: <Github className="h-4 w-4" />,
            title: "GitHub",
            description: linkedOAuth.has("github") ? "GitHub sign-in is connected." : "Link your GitHub account from this signed-in session.",
            connected: linkedOAuth.has("github"),
            children: !linkedOAuth.has("github") && (
              <button type="button" onClick={() => linkOAuth("github")} disabled={action === "github"} className={oauthButtonClass}>
                {action === "github" && <Loader2 className="h-4 w-4 animate-spin" />}
                Link GitHub
              </button>
            ),
          })}
        </div>
      )}
    </div>
  )
}
