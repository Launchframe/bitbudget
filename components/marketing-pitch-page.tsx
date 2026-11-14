"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { BitbudgetLogo } from "@/components/bitbudget-logo"
import {
  MARKETING_CTA_BUTTON_LABEL,
  MARKETING_ENCRYPTED_PAYEES_NOTES,
  MARKETING_ENVELOPE_BUDGETING,
  MARKETING_FOOTER_SUFFIX,
  MARKETING_HEADER_GET_STARTED,
  MARKETING_SOURCE_REPO_URL,
  MARKETING_TRUST_PARAGRAPH,
  MARKETING_TRUST_TAIL,
  MARKETING_VARIANT_CONFIG,
  type MarketingPitchVariant,
} from "@/lib/marketing-pitch-copy"
import { ArrowRight, BarChart3, PieChart, Shield, TrendingUp, Wallet, Zap } from "lucide-react"

export function MarketingPitchPage({ variant }: { variant: MarketingPitchVariant }) {
  const router = useRouter()
  const config = MARKETING_VARIANT_CONFIG[variant]
  const logoVariant = config.logoVariant === "vanilla" ? "vanilla" : undefined

  function handleGetStarted() {
    try {
      sessionStorage.setItem("onboardingSource", config.onboardingSource)
    } catch {
      /* storage unavailable */
    }
    router.push("/auth")
  }

  const BadgeIcon = config.hero.badge.icon === "zap" ? Zap : PieChart
  const HighlightIcon = config.features.highlight.icon === "trending" ? TrendingUp : BarChart3

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between bg-background/80 px-6 py-4 backdrop-blur-[120px]">
        <BitbudgetLogo variant={logoVariant} />
        <button
          type="button"
          onClick={handleGetStarted}
          className="rounded-xl bg-[#F7931A] px-5 py-2 text-sm font-semibold text-[#0D0D0D] transition-colors hover:bg-[#F7931A]/90"
        >
          {MARKETING_HEADER_GET_STARTED}
        </button>
      </header>

      <section className="mx-auto flex max-w-4xl flex-col items-center justify-center px-6 pt-32 pb-20 text-center md:pt-44 md:pb-28">
        {config.hero.pitchSwitchBanner ? (
          <Link
            href={config.hero.pitchSwitchBanner.href}
            className="mb-6 inline-flex max-w-xl items-center justify-center gap-2 rounded-full border border-[#F7931A]/25 bg-[#F7931A]/10 px-4 py-2 text-xs font-medium text-[#F7931A] transition-colors hover:bg-[#F7931A]/15"
          >
            {config.hero.pitchSwitchBanner.label}
          </Link>
        ) : null}
        <div
          className={`mb-8 inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-xs font-medium ${config.hero.badge.className}`}
        >
          <BadgeIcon className="h-3.5 w-3.5" />
          {config.hero.badge.label}
        </div>
        <h1 className="mb-6 text-4xl leading-tight font-bold tracking-tight md:text-6xl lg:text-7xl">
          {variant === "btc" ? (
            <>
              Every Dollar You Spend <span className="text-[#F7931A]">Could Have Been Bitcoin</span>
            </>
          ) : (
            <>
              Budget Smarter. <span className="text-[#F7931A]">Spend with Intention.</span>
            </>
          )}
        </h1>
        <p className="mb-10 max-w-2xl text-lg leading-relaxed text-muted-foreground md:text-xl">{config.hero.subhead}</p>
        <div className="flex flex-col items-center gap-4 sm:flex-row">
          <button
            type="button"
            onClick={handleGetStarted}
            className="flex items-center gap-2 rounded-2xl bg-[#F7931A] px-8 py-4 text-base font-bold text-[#0D0D0D] transition-colors hover:bg-[#F7931A]/90"
          >
            {config.hero.primaryCta}
            <ArrowRight className="h-5 w-5" />
          </button>
          <a
            href="#features"
            className="px-8 py-4 text-base font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            Learn More
          </a>
        </div>
      </section>

      <section id="features" className="mx-auto max-w-5xl px-6 pb-20 md:pb-28">
        <div className="grid gap-6 md:grid-cols-3">
          <MarketingFeatureCard
            icon={<HighlightIcon className={`h-6 w-6 ${config.features.highlight.accentClass}`} />}
            title={config.features.highlight.title}
            description={config.features.highlight.description}
          />
          <MarketingFeatureCard
            icon={<Wallet className="h-6 w-6 text-[#8B5CF6]" />}
            title={MARKETING_ENVELOPE_BUDGETING.title}
            description={MARKETING_ENVELOPE_BUDGETING.description}
          />
          <MarketingFeatureCard
            icon={<Shield className="h-6 w-6 text-[#22C55E]" />}
            title={MARKETING_ENCRYPTED_PAYEES_NOTES.title}
            description={MARKETING_ENCRYPTED_PAYEES_NOTES.body}
          />
        </div>
      </section>

      <section className="mx-auto max-w-4xl px-6 pb-20 md:pb-28">
        <h2 className="mb-12 text-center text-3xl font-bold md:text-4xl">How It Works</h2>
        <div className="flex flex-col gap-8">
          {config.howItWorks.map((item) => (
            <div key={item.step} className="flex items-start gap-5">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#F7931A] text-lg font-bold text-[#0D0D0D]">
                {item.step}
              </div>
              <div>
                <h3 className="mb-1 text-lg font-semibold">{item.title}</h3>
                <p className="leading-relaxed text-muted-foreground">{item.description}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-3xl px-6 pb-20 text-center md:pb-28">
        <div className="rounded-3xl border border-[#1F1F1F] bg-[#0D0D0D] p-8 md:p-12">
          <h2 className="mb-4 text-2xl font-bold md:text-3xl">{config.cta.title}</h2>
          <p className="mx-auto mb-8 max-w-lg text-muted-foreground">
            {config.cta.leadSentence ? (
              <>
                {config.cta.leadSentence} The app is{" "}
              </>
            ) : (
              <>
                The app is{" "}
              </>
            )}
            <a
              href={MARKETING_SOURCE_REPO_URL}
              className="text-foreground underline decoration-[#F7931A]/50 underline-offset-2 hover:decoration-[#F7931A]"
              rel="noopener noreferrer"
            >
              MIT-licensed open source
            </a>
            ; {MARKETING_TRUST_PARAGRAPH} {MARKETING_TRUST_TAIL}
          </p>
          <button
            type="button"
            onClick={handleGetStarted}
            className="inline-flex items-center gap-2 rounded-2xl bg-[#F7931A] px-8 py-4 text-base font-bold text-[#0D0D0D] transition-colors hover:bg-[#F7931A]/90"
          >
            {MARKETING_CTA_BUTTON_LABEL}
            <ArrowRight className="h-5 w-5" />
          </button>
        </div>
      </section>

      <footer className="border-t border-[#1F1F1F] px-6 py-8 text-center">
        <div className="flex flex-col items-center gap-3">
          <BitbudgetLogo variant={logoVariant} />
          <p className="max-w-md text-xs text-muted-foreground">
            {config.footerLead} {MARKETING_FOOTER_SUFFIX}
          </p>
          <div className="flex flex-col items-center gap-2 sm:flex-row sm:gap-4">
            <Link
              href="/privacy"
              className="text-xs text-muted-foreground/60 transition-colors hover:text-muted-foreground"
            >
              Privacy Policy
            </Link>
            <a
              href={MARKETING_SOURCE_REPO_URL}
              className="text-xs text-muted-foreground/60 transition-colors hover:text-muted-foreground"
              rel="noopener noreferrer"
            >
              Source (MIT)
            </a>
            <Link
              href={config.crossPitchLink.href}
              className="text-xs text-muted-foreground/60 transition-colors hover:text-muted-foreground"
            >
              {config.crossPitchLink.label}
            </Link>
          </div>
        </div>
      </footer>
    </div>
  )
}

function MarketingFeatureCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode
  title: string
  description: string
}) {
  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-[#1F1F1F] bg-[#0D0D0D] p-6">
      <div className="w-fit rounded-xl bg-[#1A1A1A] p-3">{icon}</div>
      <h3 className="text-lg font-semibold">{title}</h3>
      <p className="text-sm leading-relaxed text-muted-foreground">{description}</p>
    </div>
  )
}
