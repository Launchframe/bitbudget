import type { Metadata } from "next"
import Link from "next/link"
import { Database, LockKeyhole, Mail, ShieldCheck } from "lucide-react"
import { BitbudgetLogo } from "@/components/bitbudget-logo"

export const metadata: Metadata = {
  title: "Privacy Policy | BitBudget",
  description:
    "Learn what BitBudget encrypts, what service data we store, and how we use contact information to provide and improve the service.",
}

const encryptedItems = [
  "Transaction payee names and transaction notes are encrypted before storage.",
  "Recurring transaction payee names and notes are encrypted before storage.",
  "Backend-created transaction payee names and notes from connected services are encrypted with your public key so only your client can decrypt them.",
  "Your privacy key is stored on our servers only as a wrapped encrypted blob. For password or PIN users, the wrapping key is derived client-side. For Nostr users, browser extension encryption is used where available.",
]

const serviceDataItems = [
  "Account identity data such as email address, Nostr public key, OAuth provider identifiers, profile name, and profile image.",
  "Budget structure and settings such as monthly income, pay cadence, envelope names, envelope colors, icons, tags, archive state, display preferences, subscription tier, onboarding state, and reminder settings.",
  "Transaction metadata such as amount, date, type, envelope assignment, tags, source, created and updated timestamps, recurring rule cadence, and optional Bitcoin/sats opportunity-cost fields when enabled.",
  "Integration data needed to operate optional features, including Plaid item/account metadata and access tokens, connected email account tokens, receipt inbox tokens, push notification subscriptions, and imported transaction IDs used for deduplication.",
  "Operational records such as sessions, email sign-in codes, referral records, survey responses, admin audit logs, and cached BTC price data.",
]

const usageItems = [
  "Provide the budgeting app, authentication, sync, reminders, referrals, optional integrations, support, and account administration.",
  "Protect the service from abuse, debug production issues, and maintain security and reliability.",
  "Improve BitBudget using privacy-preserving, aggregate analytics. We do not use ad-tech, cross-site tracking, or sell budgeting data.",
]

export default function PrivacyPolicyPage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-50 border-b border-[#1F1F1F] bg-background/80 backdrop-blur-[120px]">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <Link href="/landing" aria-label="BitBudget home">
            <BitbudgetLogo />
          </Link>
          <Link
            href="/auth"
            className="rounded-xl bg-[#F7931A] px-5 py-2 text-sm font-semibold text-[#0D0D0D] transition-colors hover:bg-[#F7931A]/90"
          >
            Sign in
          </Link>
        </div>
      </header>

      <section className="mx-auto max-w-5xl px-6 pb-20 pt-16 md:pb-28 md:pt-24">
        <div className="mb-10 inline-flex items-center gap-2 rounded-full border border-[#22C55E]/20 bg-[#22C55E]/10 px-4 py-1.5 text-xs font-medium text-[#22C55E]">
          <ShieldCheck className="h-3.5 w-3.5" />
          Privacy-first by design
        </div>

        <div className="max-w-3xl">
          <p className="mb-4 text-sm text-muted-foreground">Last updated: April 27, 2026</p>
          <h1 className="mb-6 text-4xl font-bold leading-tight tracking-tight md:text-6xl">
            BitBudget Privacy Policy
          </h1>
          <p className="text-lg leading-relaxed text-muted-foreground md:text-xl">
            BitBudget is built so your most sensitive budgeting details stay yours. This policy explains what
            we encrypt before storage, what service data we still need to store, and how we use information to
            provide and improve BitBudget.
          </p>
        </div>

        <div className="mt-12 grid gap-6 md:grid-cols-3">
          <SummaryCard
            icon={<LockKeyhole className="h-6 w-6 text-[#22C55E]" />}
            title="Encrypted details"
            description="Payees and notes are stored as ciphertext that BitBudget cannot read."
          />
          <SummaryCard
            icon={<Database className="h-6 w-6 text-[#3B82F6]" />}
            title="Service metadata"
            description="Amounts, dates, envelopes, settings, and integration records remain visible to run the app."
          />
          <SummaryCard
            icon={<Mail className="h-6 w-6 text-[#F7931A]" />}
            title="Optional feedback"
            description="We may contact you for product feedback, and you can opt out at any time."
          />
        </div>

        <div className="mt-14 space-y-8">
          <PolicySection title="What is encrypted before storage">
            <p>
              BitBudget uses client-side and public-key encryption for sensitive transaction text. We store
              ciphertext for the following data at rest:
            </p>
            <PolicyList items={encryptedItems} />
            <p>
              We do not store your raw Nostr secret key. If you use a Nostr browser extension, signing and NIP-04
              encryption happen through the extension. If you use the nsec fallback, the key is encrypted locally
              before it is saved in browser storage.
            </p>
          </PolicySection>

          <PolicySection title="What is not end-to-end encrypted">
            <p>
              Some data must remain available to BitBudget servers so the app can authenticate you, sync your
              budget, run integrations, and render summaries. This data is protected by our application,
              database, and hosting security controls, but it is not encrypted in a way that prevents BitBudget
              servers from reading it:
            </p>
            <PolicyList items={serviceDataItems} />
            <p>
              Low-friction capture features may also store non-encrypted processing metadata, such as confidence
              scores, suggested envelope IDs, and limited raw integration context. Examples include Plaid category
              metadata or a short receipt/email snippet used to help you review a pending transaction.
            </p>
          </PolicySection>

          <PolicySection title="How we use data">
            <PolicyList items={usageItems} />
            <p>
              We do not sell your personal information or budgeting data. We do not use ad-tech or cross-site
              tracking. Vercel Analytics is used only for basic aggregate usage and performance telemetry.
              When errors occur, we may send scrubbed error metadata (route, error type, stack trace) to Sentry
              so we can fix production issues. We do not send budgeting transaction details, payee names, notes,
              or encryption keys to Sentry.
            </p>
          </PolicySection>

          <PolicySection title="Feedback and product communications">
            <p>
              We may reach out by email or Nostr to ask for feedback, understand how BitBudget is working for
              you, announce important service changes, or help with support. You can opt out of non-essential
              feedback or product outreach at any time by replying to the message or using any unsubscribe or
              opt-out instructions we provide.
            </p>
            <p>
              We may still send transactional or security-related messages when needed to provide the service,
              such as sign-in codes, account notices, or important security updates.
            </p>
          </PolicySection>

          <PolicySection title="Third-party services">
            <p>
              BitBudget relies on service providers for hosting, authentication, email delivery, optional
              financial account connectivity, optional email scanning, push notifications, and aggregate
              analytics. These providers may process the data needed to perform their services for BitBudget.
            </p>
          </PolicySection>

          <PolicySection title="Your choices">
            <p>
              You control whether to use optional features such as Plaid connections, connected email scanning,
              receipt forwarding, reminders, push notifications, referrals, surveys, and opportunity-cost
              tracking. You can sign out to clear local session data, and you can contact us if you need help
              with account data or feedback opt-outs.
            </p>
          </PolicySection>
        </div>
      </section>
    </main>
  )
}

function SummaryCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode
  title: string
  description: string
}) {
  return (
    <div className="rounded-2xl border border-[#1F1F1F] bg-[#0D0D0D] p-6">
      <div className="mb-4 w-fit rounded-xl bg-[#1A1A1A] p-3">{icon}</div>
      <h3 className="mb-2 text-lg font-semibold">{title}</h3>
      <p className="text-sm leading-relaxed text-muted-foreground">{description}</p>
    </div>
  )
}

function PolicySection({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="rounded-3xl border border-[#1F1F1F] bg-[#0D0D0D] p-6 md:p-8">
      <h2 className="mb-4 text-2xl font-bold">{title}</h2>
      <div className="space-y-4 leading-relaxed text-muted-foreground">{children}</div>
    </section>
  )
}

function PolicyList({ items }: { items: string[] }) {
  return (
    <ul className="space-y-3">
      {items.map((item) => (
        <li key={item} className="flex gap-3">
          <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#F7931A]" aria-hidden />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  )
}
