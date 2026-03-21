"use client"

import { useRouter } from "next/navigation"
import { BitbudgetLogo } from "@/components/bitbudget-logo"
import { ArrowRight, Shield, BarChart3, Wallet, PieChart } from "lucide-react"

export default function WelcomePage() {
  const router = useRouter()

  function handleGetStarted() {
    try { sessionStorage.setItem("onboardingSource", "vanilla") } catch {}
    router.push("/auth")
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 py-4 bg-background/80 backdrop-blur-[120px]">
        <BitbudgetLogo variant="vanilla" />
        <button
          onClick={handleGetStarted}
          className="px-5 py-2 bg-[#F7931A] text-[#0D0D0D] rounded-xl text-sm font-semibold hover:bg-[#F7931A]/90 transition-colors"
        >
          Get Started
        </button>
      </header>

      {/* Hero */}
      <section className="flex flex-col items-center justify-center text-center px-6 pt-32 pb-20 md:pt-44 md:pb-28 max-w-4xl mx-auto">
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-[#3B82F6]/10 border border-[#3B82F6]/20 text-[#3B82F6] text-xs font-medium mb-8">
          <PieChart className="h-3.5 w-3.5" />
          Simple. Private. Yours.
        </div>
        <h1 className="text-4xl md:text-6xl lg:text-7xl font-bold leading-tight tracking-tight mb-6">
          Budget Smarter.{" "}
          <span className="text-[#F7931A]">Spend with Intention.</span>
        </h1>
        <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mb-10 leading-relaxed">
          BitBudget is a private, encrypted budgeting app that helps you take control of your money.
          Allocate your income, track your spending, and build better financial habits.
        </p>
        <div className="flex flex-col sm:flex-row items-center gap-4">
          <button
            onClick={handleGetStarted}
            className="flex items-center gap-2 px-8 py-4 bg-[#F7931A] text-[#0D0D0D] rounded-2xl text-base font-bold hover:bg-[#F7931A]/90 transition-colors"
          >
            Start Budgeting — Free
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
            icon={<Wallet className="h-6 w-6 text-[#F7931A]" />}
            title="Envelope Budgeting"
            description="Divide your income into categories — Rent, Food, Entertainment, and more. Know exactly where every dollar is going."
          />
          <FeatureCard
            icon={<BarChart3 className="h-6 w-6 text-[#3B82F6]" />}
            title="Spending Insights"
            description="Visualize your spending patterns over time. Understand your habits and make informed decisions about your money."
          />
          <FeatureCard
            icon={<Shield className="h-6 w-6 text-[#22C55E]" />}
            title="End-to-End Encrypted"
            description="Your financial data is encrypted before it leaves your browser. Not even we can read it. Your data stays yours."
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
            { step: "1", title: "Sign in securely", description: "Use your email, Google, or GitHub account. Your data is encrypted end-to-end — only you can read it." },
            { step: "2", title: "Set up your budget", description: "Enter your income and create envelopes for your spending categories. Allocate every dollar before it's spent." },
            { step: "3", title: "Track transactions", description: "Record expenses as they happen or import your history from a CSV file. Stay on top of your spending in real time." },
            { step: "4", title: "Build better habits", description: "Review your spending trends and see where adjustments can help you save more and stress less." },
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
            Ready to take control of your finances?
          </h2>
          <p className="text-muted-foreground mb-8 max-w-lg mx-auto">
            Free, open-source, and completely private. No ads, no data selling, no tracking.
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
          <BitbudgetLogo variant="vanilla" />
          <p className="text-xs text-muted-foreground">
            Open-source budgeting app. Your data is encrypted end-to-end.
          </p>
          <a
            href="/landing"
            className="text-xs text-muted-foreground/60 hover:text-muted-foreground transition-colors"
          >
            Looking for the Bitcoin opportunity cost experience? →
          </a>
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
