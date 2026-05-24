"use client"

import { useCallback, useEffect, useState } from "react"
import { AlertCircle, CheckCircle2, Loader2, Mail, Trash2, Zap } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { MAX_NOTIFICATION_EMAILS_PER_USER } from "@/lib/notification-contact"

type NotificationEmailEntry = {
  id: string
  email: string
  verifiedAt: string
}

type ContactState = {
  loginEmail: string | null
  notificationEmails: NotificationEmailEntry[]
  nostrPubkey: string | null
  nostrDmEnabled: boolean
}

const EMPTY: ContactState = {
  loginEmail: null,
  notificationEmails: [],
  nostrPubkey: null,
  nostrDmEnabled: false,
}

function shortPubkey(pubkey: string | null) {
  return pubkey ? `${pubkey.slice(0, 10)}...${pubkey.slice(-6)}` : null
}

async function readJsonError(res: Response, fallback: string) {
  const data = (await res.json().catch(() => ({}))) as { error?: string }
  return data.error ?? fallback
}

export function CommunicationChannelsCard() {
  const [contact, setContact] = useState<ContactState>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [action, setAction] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [email, setEmail] = useState("")
  const [code, setCode] = useState("")
  const [codeSent, setCodeSent] = useState(false)

  const loadContact = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/user/notification-email")
      if (!res.ok) throw new Error(await readJsonError(res, "Failed to load notification settings"))
      const data = (await res.json()) as ContactState
      setContact(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load notification settings")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadContact()
  }, [loadContact])

  async function sendCode(e: React.FormEvent) {
    e.preventDefault()
    setAction("send-code")
    setError(null)
    setSuccess(null)
    try {
      const res = await fetch("/api/user/notification-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "send-code", email }),
      })
      if (!res.ok) throw new Error(await readJsonError(res, "Failed to send code"))
      setCodeSent(true)
      setSuccess("Check your inbox for a 6-digit verification code.")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send code")
    } finally {
      setAction(null)
    }
  }

  async function verifyEmail(e: React.FormEvent) {
    e.preventDefault()
    setAction("verify")
    setError(null)
    setSuccess(null)
    try {
      const res = await fetch("/api/user/notification-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "verify", email, code }),
      })
      if (!res.ok) throw new Error(await readJsonError(res, "Failed to verify email"))
      setCode("")
      setCodeSent(false)
      setEmail("")
      setSuccess("Notification email verified.")
      await loadContact()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to verify email")
    } finally {
      setAction(null)
    }
  }

  async function removeNotificationEmail(target: NotificationEmailEntry) {
    setAction(`unlink-${target.id}`)
    setError(null)
    setSuccess(null)
    try {
      const res = await fetch(
        `/api/user/notification-email?id=${encodeURIComponent(target.id)}`,
        { method: "DELETE" },
      )
      if (!res.ok) throw new Error(await readJsonError(res, "Failed to remove email"))
      setSuccess(`Removed ${target.email}.`)
      await loadContact()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove email")
    } finally {
      setAction(null)
    }
  }

  async function setNostrDmEnabled(enabled: boolean) {
    setContact(prev => ({ ...prev, nostrDmEnabled: enabled }))
    setError(null)
    try {
      const res = await fetch("/api/user/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nostrDmEnabled: enabled }),
      })
      if (!res.ok) throw new Error(await readJsonError(res, "Failed to update Nostr DM preference"))
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update Nostr DM preference")
      await loadContact()
    }
  }

  const hasLoginEmail = Boolean(contact.loginEmail?.trim())
  const linkedCount = contact.notificationEmails.length
  const atEmailLimit = linkedCount >= MAX_NOTIFICATION_EMAILS_PER_USER
  const hasAnyEmailChannel = hasLoginEmail || linkedCount > 0
  const canAddEmail = !atEmailLimit

  return (
    <div className="p-6 bg-[#0D0D0D] rounded-2xl">
      <div className="flex items-center gap-3 mb-4">
        <div className="p-2 rounded-lg bg-[#3B82F6]/10">
          <Mail className="h-5 w-5 text-[#3B82F6]" />
        </div>
        <div>
          <h3 className="text-lg font-semibold text-foreground">How we reach you</h3>
          <p className="text-sm text-muted-foreground">
            Add one or more notification emails and/or enable Nostr DMs. These channels are independent from how you
            sign in.
          </p>
        </div>
      </div>

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-400">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>{error}</span>
        </div>
      )}
      {success && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-success/20 bg-success/10 p-3 text-sm text-success">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>{success}</span>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Loading channels...
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="rounded-xl border border-[#1F1F1F] bg-[#111] p-4">
            <div className="flex gap-3">
              <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#1A1A1A] text-muted-foreground">
                <Mail className="h-4 w-4" aria-hidden />
              </div>
              <div className="min-w-0 flex-1">
                <h4 className="text-sm font-semibold text-foreground">Email notifications</h4>
                <p className="mt-1 text-sm text-muted-foreground">
                  {hasLoginEmail
                    ? "Your sign-in address always receives notifications. You can add more verified addresses below."
                    : "Verify one or more addresses to receive email updates without using email to sign in."}
                </p>
              </div>
            </div>

            <ul className="mt-4 flex flex-col gap-2">
              {hasLoginEmail && (
                <li className="flex items-center justify-between gap-3 rounded-lg border border-[#1F1F1F] bg-[#0D0D0D] px-3 py-2 text-sm">
                  <span className="truncate text-foreground">{contact.loginEmail}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">Sign-in email</span>
                </li>
              )}
              {contact.notificationEmails.map((entry) => (
                <li
                  key={entry.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-[#1F1F1F] bg-[#0D0D0D] px-3 py-2 text-sm"
                >
                  <span className="truncate text-foreground">{entry.email}</span>
                  <button
                    type="button"
                    onClick={() => removeNotificationEmail(entry)}
                    disabled={action === `unlink-${entry.id}`}
                    className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground hover:text-red-400 disabled:opacity-50"
                    aria-label={`Remove ${entry.email}`}
                  >
                    {action === `unlink-${entry.id}` ? (
                      <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                    ) : (
                      <Trash2 className="h-3 w-3" aria-hidden />
                    )}
                    Remove
                  </button>
                </li>
              ))}
            </ul>

            {canAddEmail && (
              <form
                className="mt-4 flex flex-col gap-3"
                onSubmit={codeSent ? verifyEmail : sendCode}
              >
                <Input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="Add another email address"
                  aria-label="Notification email address"
                  disabled={codeSent}
                  required
                />
                {codeSent && (
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
                  disabled={action === "send-code" || action === "verify"}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-[#333] bg-[#1A1A1A] px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-[#222] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {(action === "send-code" || action === "verify") && (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  )}
                  {codeSent ? "Verify and add email" : "Send verification code"}
                </button>
              </form>
            )}
            {atEmailLimit && (
              <p className="mt-3 text-xs text-muted-foreground">
                You have reached the maximum of {MAX_NOTIFICATION_EMAILS_PER_USER} linked notification addresses.
              </p>
            )}
          </div>

          {contact.nostrPubkey && (
            <div className="rounded-xl border border-[#1F1F1F] bg-[#111] p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex gap-3">
                  <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#1A1A1A] text-muted-foreground">
                    <Zap className="h-4 w-4" aria-hidden />
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold text-foreground">Nostr direct messages</h4>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Also receive BitBudget updates as encrypted DMs to{" "}
                      <span className="font-mono text-foreground">{shortPubkey(contact.nostrPubkey)}</span>
                      {hasAnyEmailChannel
                        ? ", in addition to your email notification addresses."
                        : "."}
                    </p>
                  </div>
                </div>
                <Switch
                  checked={contact.nostrDmEnabled}
                  onCheckedChange={setNostrDmEnabled}
                  aria-label={`${contact.nostrDmEnabled ? "Disable" : "Enable"} Nostr direct messages`}
                  className="mt-0.5 data-[state=checked]:bg-[#F7931A]"
                />
              </div>
              {!hasAnyEmailChannel && !contact.nostrDmEnabled && (
                <p className="mt-3 text-xs text-muted-foreground">
                  Add a verified notification email, enable Nostr DMs, or both so BitBudget can reach you.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
