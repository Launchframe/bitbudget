"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { BitbudgetLogo } from "@/components/bitbudget-logo"
import { ArrowRight, Shield, TrendingUp, Wallet, Zap } from "lucide-react"

export default function LandingPage() {
  const router = useRouter()

  function handleGetStarted() {
    try { sessionStorage.setItem("onboardingSource", "btc") } catch {}
    router.push("/auth")
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 py-4 bg-background/80 backdrop-blur-[120px]">
        <BitbudgetLogo />
        <button
          onClick={handleGetStarted}
          className="px-5 py-2 bg-[#F7931A] text-[#0D0D0D] rounded-xl text-sm font-semibold hover:bg-[#F7931A]/90 transition-colors"
        >
          Get Started
        </button>
      </header>

      {/* Hero */}
      <section className="flex flex-col items-center justify-center text-center px-6 pt-32 pb-20 md:pt-44 md:pb-28 max-w-4xl mx-auto">
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-[#F7931A]/10 border border-[#F7931A]/20 text-[#F7931A] text-xs font-medium mb-8">
          <Zap className="h-3.5 w-3.5" />
          Powered by the Bitcoin standard
        </div>
        <h1 className="text-4xl md:text-6xl lg:text-7xl font-bold leading-tight tracking-tight mb-6">
          Every Dollar You Spend{" "}
          <span className="text-[#F7931A]">Could Have Been Bitcoin</span>
        </h1>
        <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mb-10 leading-relaxed">
          BitBudget tracks the opportunity cost of your spending in Bitcoin terms.
          See what your purchases would be worth today — and think twice before your next expense.
        </p>
        <div className="flex flex-col sm:flex-row items-center gap-4">
          <button
            onClick={handleGetStarted}
            className="flex items-center gap-2 px-8 py-4 bg-[#F7931A] text-[#0D0D0D] rounded-2xl text-base font-bold hover:bg-[#F7931A]/90 transition-colors"
          >
            Start Tracking
            <ArrowRight className="h-5 w-5" />
          </button>
          <a
            href="#features"
            className="px-8 py-4 text-muted-foreground hover:text-foreground text-base font-medium transition-colors"
          >
            Learn More
          </a>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="px-6 pb-20 md:pb-28 max-w-5xl mx-auto">
        <div className="grid md:grid-cols-3 gap-6">
          <FeatureCard
            icon={<TrendingUp className="h-6 w-6 text-[#F7931A]" />}
            title="Opportunity Cost Tracking"
            description="Every transaction shows what it would be worth in Bitcoin today. Watch your spending history transform into a powerful savings motivator."
          />
          <FeatureCard
            icon={<Wallet className="h-6 w-6 text-[#8B5CF6]" />}
            title="Envelope Budgeting"
            description="Organize spending into envelopes — Rent, Food, Entertainment, and more. Allocate your income and track where every dollar goes."
          />
          <FeatureCard
            icon={<Shield className="h-6 w-6 text-[#22C55E]" />}
            title="End-to-End Encrypted"
            description="Your financial data is encrypted before it leaves your browser. Not even we can read it. Your keys, your data, your sovereignty."
          />
        </div>
      </section>

      {/* How It Works */}
      <section className="px-6 pb-20 md:pb-28 max-w-4xl mx-auto">
        <h2 className="text-3xl md:text-4xl font-bold text-center mb-12">
          How It Works
        </h2>
        <div className="flex flex-col gap-8">
          {[
            { step: "1", title: "Sign in with Nostr or email", description: "Use your Nostr extension for cypherpunk-grade auth, or sign in with email, Google, or GitHub." },
            { step: "2", title: "Set up your budget", description: "Enter your income, create envelopes for your spending categories, and allocate your paycheck." },
            { step: "3", title: "Log transactions", description: "Record expenses as they happen, or import your transaction history from a CSV." },
            { step: "4", title: "See the opportunity cost", description: "Every dollar spent is shown alongside what it would be worth in Bitcoin today. Stack sats smarter." },
          ].map((item) => (
            <div key={item.step} className="flex gap-5 items-start">
              <div className="shrink-0 h-10 w-10 rounded-full bg-[#F7931A] text-[#0D0D0D] flex items-center justify-center text-lg font-bold">
                {item.step}
              </div>
              <div>
                <h3 className="text-lg font-semibold mb-1">{item.title}</h3>
                <p className="text-muted-foreground leading-relaxed">{item.description}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="px-6 pb-20 md:pb-28 max-w-3xl mx-auto text-center">
        <div className="p-8 md:p-12 bg-[#0D0D0D] rounded-3xl border border-[#1F1F1F]">
          <h2 className="text-2xl md:text-3xl font-bold mb-4">
            Ready to see the true cost of spending?
          </h2>
          <p className="text-muted-foreground mb-8 max-w-lg mx-auto">
            Join the Bitcoiners who are rethinking every purchase. Free, open-source, and sovereign.
          </p>
          <button
            onClick={handleGetStarted}
            className="inline-flex items-center gap-2 px-8 py-4 bg-[#F7931A] text-[#0D0D0D] rounded-2xl text-base font-bold hover:bg-[#F7931A]/90 transition-colors"
          >
            Get Started — It&apos;s Free
            <ArrowRight className="h-5 w-5" />
          </button>
        </div>
      </section>

      {/* Footer */}
      <footer className="px-6 py-8 border-t border-[#1F1F1F] text-center">
        <div className="flex flex-col items-center gap-3">
          <BitbudgetLogo />
          <p className="text-xs text-muted-foreground">
            Open-source Bitcoin opportunity cost tracker. Your data is encrypted end-to-end.
          </p>
          <Link href="/faq" prefetch={false} className="text-xs text-muted-foreground/60 hover:text-muted-foreground transition-colors">FAQ</Link>
          <Link
            href="/privacy"
            className="text-xs text-muted-foreground/60 hover:text-muted-foreground transition-colors"
          >
            Privacy Policy
          </Link>
        </div>
      </footer>
    </div>
  )
}

function FeatureCard({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <div className="p-6 bg-[#0D0D0D] rounded-2xl border border-[#1F1F1F] flex flex-col gap-4">
      <div className="p-3 rounded-xl bg-[#1A1A1A] w-fit">{icon}</div>
      <h3 className="text-lg font-semibold">{title}</h3>
      <p className="text-sm text-muted-foreground leading-relaxed">{description}</p>
    </div>
  )
}
