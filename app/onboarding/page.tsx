"use client"

import { useState, useCallback, useRef } from "react"
import { useRouter } from "next/navigation"
import { BitbudgetLogo } from "@/components/bitbudget-logo"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { Plus, Trash2, Pencil, ChevronRight, ChevronLeft, Lock, Wallet, DollarSign, PiggyBank, PieChart, Upload, X } from "lucide-react"
import { EnvelopeAppearancePicker } from "@/components/envelope-appearance-picker"
import { suggestIcon, getEnvelopeIcon } from "@/lib/envelope-icons"
import { CSVImportDialog } from "@/components/csv-import-dialog"
import {
  deriveKeyFromPin,
  generateSalt,
  generatePrivacyKey,
  encryptPrivacyKey,
  uint8ToHex,
  hexToUint8,
} from "@/lib/crypto"

type Step = "security" | "income" | "envelopes" | "allocations" | "import" | "complete"

const STEPS: Step[] = ["security", "income", "envelopes", "allocations", "import", "complete"]
const ENVELOPE_COLORS = ["#F7931A", "#3B82F6", "#10B981", "#8B5CF6", "#EF4444", "#EAB308", "#EC4899", "#06B6D4"]

interface DraftEnvelope {
  name: string
  color: string
  icon: string
  monthlyAllotment: number
}

export default function OnboardingPage() {
  const router = useRouter()
  const [step, setStep] = useState<Step>("security")
  const [loading, setLoading] = useState(false)
  const [isNostr, setIsNostr] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)

  // Security
  const [pin, setPin] = useState("")
  const [pinConfirm, setPinConfirm] = useState("")
  const [pinError, setPinError] = useState("")

  // Income
  const [income, setIncome] = useState("")
  const [cadence, setCadence] = useState<"monthly" | "bimonthly">("monthly")

  // Envelopes
  const [envelopes, setEnvelopes] = useState<DraftEnvelope[]>([
    { name: "Rent", color: ENVELOPE_COLORS[0], icon: suggestIcon("Rent"), monthlyAllotment: 0 },
    { name: "Food", color: ENVELOPE_COLORS[2], icon: suggestIcon("Food"), monthlyAllotment: 0 },
    { name: "Transportation", color: ENVELOPE_COLORS[4], icon: suggestIcon("Transportation"), monthlyAllotment: 0 },
  ])
  const [newEnvName, setNewEnvName] = useState("")
  const [expandedEnvIdx, setExpandedEnvIdx] = useState<number | null>(null)

  // Allocations
  const [activeEnvIdx, setActiveEnvIdx] = useState<number | null>(null)
  const sliderRowRefs = useRef<(HTMLDivElement | null)[]>([])

  // Import
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importDialogOpen, setImportDialogOpen] = useState(false)
  const [importResult, setImportResult] = useState<{ imported: number; skipped: number; newEnvelopes: string[] } | null>(null)

  const stepIndex = STEPS.indexOf(step)
  const progress = ((stepIndex + 1) / STEPS.length) * 100

  const checkIfNostr = useCallback(async () => {
    try {
      const res = await fetch("/api/user/encryption")
      const data = await res.json()
      if (data.userId) setUserId(data.userId)
      if (data.isNostr) {
        setIsNostr(true)

        if (!data.encryptedPrivacyKey && data.nostrPubkey) {
          const nostrExt = (window as unknown as {
            nostr?: {
              getPublicKey: () => Promise<string>
              nip04?: { encrypt: (pubkey: string, plaintext: string) => Promise<string> }
            }
          }).nostr

          if (nostrExt?.nip04) {
            const privacyKey = generatePrivacyKey()
            const encrypted = await nostrExt.nip04.encrypt(data.nostrPubkey, uint8ToHex(privacyKey))
            await fetch("/api/user/encryption", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ encryptedPrivacyKey: encrypted }),
            })
            sessionStorage.setItem("bitbudget-privacy-key", uint8ToHex(privacyKey))
            if (data.userId) sessionStorage.setItem("bitbudget-privacy-user", data.userId)
          }
        }

        setStep("income")
      }
    } catch { /* continue normally */ }
  }, [])

  useState(() => { checkIfNostr() })

  async function handleSecuritySetup() {
    if (pin.length < 4) {
      setPinError("PIN must be at least 4 characters")
      return
    }
    if (pin !== pinConfirm) {
      setPinError("PINs don't match")
      return
    }
    setPinError("")
    setLoading(true)

    try {
      const salt = generateSalt()
      const derivedKey = await deriveKeyFromPin(pin, salt)
      const privacyKey = generatePrivacyKey()
      const encrypted = await encryptPrivacyKey(privacyKey, derivedKey)

      await fetch("/api/user/encryption", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          encryptedPrivacyKey: JSON.stringify(encrypted),
          privacyKeySalt: uint8ToHex(salt),
        }),
      })

      if (typeof window !== "undefined") {
        sessionStorage.setItem("bitbudget-privacy-key", uint8ToHex(privacyKey))
        if (userId) sessionStorage.setItem("bitbudget-privacy-user", userId)
      }

      setStep("income")
    } catch {
      setPinError("Failed to set up encryption. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  async function handleIncomeSave() {
    setLoading(true)
    try {
      await fetch("/api/user/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          monthlyIncome: parseFloat(income) || 0,
          payCadence: cadence,
        }),
      })
      setStep("envelopes")
    } finally {
      setLoading(false)
    }
  }

  function addEnvelope() {
    if (!newEnvName.trim()) return
    const name = newEnvName.trim()
    setEnvelopes(prev => [
      ...prev,
      {
        name,
        color: ENVELOPE_COLORS[prev.length % ENVELOPE_COLORS.length],
        icon: suggestIcon(name),
        monthlyAllotment: 0,
      },
    ])
    setNewEnvName("")
  }

  function removeEnvelope(idx: number) {
    setEnvelopes(prev => prev.filter((_, i) => i !== idx))
  }

  async function handleEnvelopesSave() {
    if (envelopes.length === 0) return
    setLoading(true)
    try {
      for (const env of envelopes) {
        await fetch("/api/envelopes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: env.name, color: env.color, icon: env.icon, monthlyAllotment: env.monthlyAllotment }),
        })
      }
      setStep("allocations")
    } finally {
      setLoading(false)
    }
  }

  async function handleAllocationsSave() {
    setLoading(true)
    try {
      const res = await fetch("/api/envelopes")
      const serverEnvelopes = await res.json()

      for (let i = 0; i < envelopes.length; i++) {
        const serverEnv = serverEnvelopes.find(
          (e: { name: string }) => e.name === envelopes[i].name,
        )
        if (serverEnv && envelopes[i].monthlyAllotment > 0) {
          await fetch("/api/envelopes", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              id: serverEnv.id,
              monthlyAllotment: envelopes[i].monthlyAllotment,
            }),
          })
        }
      }
      setStep("import")
    } finally {
      setLoading(false)
    }
  }

  function handleImport() {
    if (!importFile) { setStep("complete"); return }
    setImportDialogOpen(true)
  }

  function handleImportDialogClose(isOpen: boolean) {
    setImportDialogOpen(isOpen)
    if (!isOpen) {
      setStep("complete")
    }
  }

  async function handleComplete() {
    setLoading(true)
    try {
      await fetch("/api/user/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ onboardingComplete: true }),
      })
      router.push("/")
      router.refresh()
    } finally {
      setLoading(false)
    }
  }

  const totalAllocated = envelopes.reduce((s, e) => s + e.monthlyAllotment, 0)
  const monthlyIncome = parseFloat(income) || 0
  const savings = Math.max(0, monthlyIncome - totalAllocated)
  const savingsPct = monthlyIncome > 0 ? Math.round((savings / monthlyIncome) * 100) : 0

  return (
    <div className="min-h-screen bg-background flex flex-col items-center p-6">
      <div className="w-full max-w-lg flex flex-col gap-6 pt-8">
        <div className="flex items-center justify-between">
          <BitbudgetLogo />
          <span className="text-xs text-muted-foreground">
            Step {stepIndex + 1} of {STEPS.length}
          </span>
        </div>

        <Progress value={progress} className="h-1.5" />

        <div className="bg-[#0D0D0D] rounded-2xl p-8">
          {/* Security Step */}
          {step === "security" && !isNostr && (
            <form onSubmit={e => { e.preventDefault(); handleSecuritySetup() }} className="flex flex-col gap-6">
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-xl bg-[#F7931A]/10">
                  <Lock className="h-6 w-6 text-[#F7931A]" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-foreground">Secure Your Data</h2>
                  <p className="text-sm text-muted-foreground">Create a PIN to encrypt your private data</p>
                </div>
              </div>

              <p className="text-sm text-muted-foreground leading-relaxed">
                Your transaction details (payees, descriptions) are encrypted before leaving your device.
                This PIN derives the encryption key. <strong>If you lose it, your data cannot be recovered.</strong>
              </p>

              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <Label className="text-muted-foreground text-xs uppercase tracking-wider">PIN or Password</Label>
                  <Input
                    type="password"
                    value={pin}
                    onChange={e => setPin(e.target.value)}
                    placeholder="At least 4 characters"
                    className="bg-[#1A1A1A] border-[#333] text-foreground placeholder:text-[#555]"
                    minLength={4}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label className="text-muted-foreground text-xs uppercase tracking-wider">Confirm PIN</Label>
                  <Input
                    type="password"
                    value={pinConfirm}
                    onChange={e => setPinConfirm(e.target.value)}
                    placeholder="Re-enter your PIN"
                    className="bg-[#1A1A1A] border-[#333] text-foreground placeholder:text-[#555]"
                  />
                </div>
                {pinError && <p className="text-sm text-red-400">{pinError}</p>}
              </div>

              <button
                type="submit"
                disabled={loading || !pin || !pinConfirm}
                className="w-full py-3 bg-[#F7931A] text-[#0D0D0D] rounded-xl font-semibold text-sm hover:bg-[#F7931A]/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {loading ? "Setting up..." : "Continue"}
                {!loading && <ChevronRight className="h-4 w-4" />}
              </button>
            </form>
          )}

          {/* Income Step */}
          {step === "income" && (
            <form onSubmit={e => { e.preventDefault(); if (income) handleIncomeSave() }} className="flex flex-col gap-6">
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-xl bg-[#22C55E]/10">
                  <DollarSign className="h-6 w-6 text-[#22C55E]" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-foreground">Your Income</h2>
                  <p className="text-sm text-muted-foreground">How much do you earn after taxes?</p>
                </div>
              </div>

              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <Label className="text-muted-foreground text-xs uppercase tracking-wider">After-Tax Income (USD)</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                    <Input
                      type="number"
                      value={income}
                      onChange={e => setIncome(e.target.value)}
                      placeholder="5,000"
                      className="bg-[#1A1A1A] border-[#333] text-foreground placeholder:text-[#555] pl-7 text-lg"
                      min="0"
                      step="100"
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <Label className="text-muted-foreground text-xs uppercase tracking-wider">Pay Frequency</Label>
                  <div className="flex rounded-lg bg-[#1A1A1A] p-1">
                    <button
                      type="button"
                      onClick={() => setCadence("monthly")}
                      className={`flex-1 py-2.5 text-sm font-medium rounded-md transition-colors ${
                        cadence === "monthly"
                          ? "bg-[#F7931A] text-[#0D0D0D]"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      Monthly
                    </button>
                    <button
                      type="button"
                      onClick={() => setCadence("bimonthly")}
                      className={`flex-1 py-2.5 text-sm font-medium rounded-md transition-colors ${
                        cadence === "bimonthly"
                          ? "bg-[#F7931A] text-[#0D0D0D]"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      Bi-Monthly
                    </button>
                  </div>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading || !income}
                className="w-full py-3 bg-[#F7931A] text-[#0D0D0D] rounded-xl font-semibold text-sm hover:bg-[#F7931A]/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {loading ? "Saving..." : "Continue"}
                {!loading && <ChevronRight className="h-4 w-4" />}
              </button>
            </form>
          )}

          {/* Envelopes Step */}
          {step === "envelopes" && (
            <form onSubmit={e => { e.preventDefault(); if (envelopes.length > 0) handleEnvelopesSave() }} className="flex flex-col gap-6">
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-xl bg-[#8B5CF6]/10">
                  <Wallet className="h-6 w-6 text-[#8B5CF6]" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-foreground">Your Envelopes</h2>
                  <p className="text-sm text-muted-foreground">Create spending categories</p>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                {envelopes.map((env, idx) => {
                  const Icon = getEnvelopeIcon(env.icon)
                  const isExpanded = expandedEnvIdx === idx
                  return (
                    <div key={idx} className="flex flex-col bg-[#1A1A1A] rounded-xl overflow-hidden">
                      <div className="flex items-center gap-3 p-3">
                        <button
                          type="button"
                          onClick={() => setExpandedEnvIdx(isExpanded ? null : idx)}
                          className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center transition-colors hover:opacity-80"
                          style={{ backgroundColor: `${env.color}22` }}
                          title="Customize appearance"
                        >
                          <Icon className="h-4 w-4" style={{ color: env.color }} />
                        </button>
                        <span className="flex-1 text-sm font-medium text-foreground">{env.name}</span>
                        <button
                          type="button"
                          onClick={() => setExpandedEnvIdx(isExpanded ? null : idx)}
                          className="p-1 text-muted-foreground hover:text-foreground transition-colors"
                          title="Edit appearance"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => { removeEnvelope(idx); if (expandedEnvIdx === idx) setExpandedEnvIdx(null) }}
                          className="p-1 text-muted-foreground hover:text-red-400 transition-colors"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>

                      {isExpanded && (
                        <div className="border-t border-[#2A2A2A] px-3 pb-3 pt-3">
                          <div className="flex items-center justify-between mb-3">
                            <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Appearance</span>
                            <button
                              type="button"
                              onClick={() => setExpandedEnvIdx(null)}
                              className="text-muted-foreground hover:text-foreground transition-colors"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                          <EnvelopeAppearancePicker
                            color={env.color}
                            icon={env.icon}
                            existingEnvelopes={envelopes.map((e, i) => ({ id: String(i), name: e.name, icon: e.icon }))}
                            editingId={String(idx)}
                            onColorChange={color => setEnvelopes(prev => prev.map((e, i) => i === idx ? { ...e, color } : e))}
                            onIconChange={icon => setEnvelopes(prev => prev.map((e, i) => i === idx ? { ...e, icon } : e))}
                            onReassignIcon={fromId => {
                              const fromIdx = parseInt(fromId)
                              setEnvelopes(prev => prev.map((e, i) => i === fromIdx ? { ...e, icon: "Wallet" } : e))
                            }}
                          />
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              <div className="flex gap-2">
                <Input
                  value={newEnvName}
                  onChange={e => setNewEnvName(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addEnvelope() } }}
                  placeholder="Add new envelope..."
                  className="bg-[#1A1A1A] border-[#333] text-foreground placeholder:text-[#555]"
                />
                <button
                  type="button"
                  onClick={addEnvelope}
                  disabled={!newEnvName.trim()}
                  className="px-4 py-2 bg-[#1A1A1A] border border-[#333] text-foreground rounded-lg hover:bg-[#222] transition-colors disabled:opacity-30"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setStep("income")}
                  className="flex-1 py-3 bg-[#1A1A1A] text-foreground rounded-xl font-semibold text-sm hover:bg-[#222] transition-colors border border-[#333] flex items-center justify-center gap-2"
                >
                  <ChevronLeft className="h-4 w-4" /> Back
                </button>
                <button
                  type="submit"
                  disabled={loading || envelopes.length === 0}
                  className="flex-1 py-3 bg-[#F7931A] text-[#0D0D0D] rounded-xl font-semibold text-sm hover:bg-[#F7931A]/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {loading ? "Saving..." : "Continue"}
                  {!loading && <ChevronRight className="h-4 w-4" />}
                </button>
              </div>
            </form>
          )}

          {/* Allocations Step */}
          {step === "allocations" && (
            <form onSubmit={e => { e.preventDefault(); handleAllocationsSave() }} className="flex flex-col gap-6">
              <style>{`
                input[type="range"].alloc-slider {
                  -webkit-appearance: none;
                  appearance: none;
                  width: 100%;
                  height: 6px;
                  border-radius: 3px;
                  outline: none;
                  cursor: pointer;
                }
                input[type="range"].alloc-slider::-webkit-slider-thumb {
                  -webkit-appearance: none;
                  appearance: none;
                  width: 22px;
                  height: 22px;
                  border-radius: 50%;
                  background: var(--slider-color);
                  border: 3px solid #0D0D0D;
                  box-shadow: 0 0 0 2px var(--slider-color);
                  cursor: grab;
                }
                input[type="range"].alloc-slider::-webkit-slider-thumb:active {
                  cursor: grabbing;
                  transform: scale(1.15);
                }
                input[type="range"].alloc-slider::-moz-range-thumb {
                  width: 22px;
                  height: 22px;
                  border-radius: 50%;
                  background: var(--slider-color);
                  border: 3px solid #0D0D0D;
                  box-shadow: 0 0 0 2px var(--slider-color);
                  cursor: grab;
                }
                input[type="range"].alloc-slider::-moz-range-thumb:active {
                  cursor: grabbing;
                }
                input[type="range"].alloc-slider::-webkit-slider-runnable-track {
                  height: 6px;
                  border-radius: 3px;
                  background: linear-gradient(
                    to right,
                    var(--slider-color) 0%,
                    var(--slider-color) var(--slider-pct),
                    #1F1F1F var(--slider-pct),
                    #1F1F1F 100%
                  );
                }
                input[type="range"].alloc-slider::-moz-range-track {
                  height: 6px;
                  border-radius: 3px;
                  background: #1F1F1F;
                }
                input[type="range"].alloc-slider::-moz-range-progress {
                  height: 6px;
                  border-radius: 3px;
                  background: var(--slider-color);
                }
              `}</style>

              <div className="flex items-center gap-3">
                <div className="p-3 rounded-xl bg-[#3B82F6]/10">
                  <PieChart className="h-6 w-6 text-[#3B82F6]" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-foreground">Allocate Income</h2>
                  <p className="text-sm text-muted-foreground">Distribute ${monthlyIncome.toLocaleString()} across envelopes</p>
                </div>
              </div>

              {/* Stacked bar */}
              {monthlyIncome > 0 && (
                <div className="flex flex-col gap-2">
                  <div className="flex h-10 rounded-xl overflow-hidden bg-[#1A1A1A]">
                    {envelopes.map((env, idx) => {
                      const pct = (env.monthlyAllotment / monthlyIncome) * 100
                      if (pct <= 0) return null
                      const Icon = getEnvelopeIcon(env.icon)
                      return (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => {
                            setActiveEnvIdx(idx)
                            sliderRowRefs.current[idx]?.scrollIntoView({ behavior: "smooth", block: "center" })
                          }}
                          className={`flex items-center justify-center transition-all relative ${
                            activeEnvIdx === idx ? "brightness-110" : "hover:brightness-110"
                          }`}
                          style={{
                            width: `${pct}%`,
                            backgroundColor: env.color,
                            minWidth: pct > 0 ? 4 : 0,
                          }}
                          title={`${env.name}: $${env.monthlyAllotment.toLocaleString()} (${Math.round(pct)}%)`}
                        >
                          {pct > 8 && <Icon className="h-4 w-4 text-[#0D0D0D]/70" />}
                        </button>
                      )
                    })}
                    {savings > 0 && (
                      <div
                        className="flex items-center justify-center"
                        style={{
                          width: `${savingsPct}%`,
                          backgroundColor: "rgba(34, 197, 94, 0.25)",
                          minWidth: 4,
                        }}
                        title={`Savings: $${savings.toLocaleString()} (${savingsPct}%)`}
                      >
                        {savingsPct > 8 && <PiggyBank className="h-4 w-4 text-[#22C55E]/60" />}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
                    <span>${totalAllocated.toLocaleString()} allocated</span>
                    <span>${monthlyIncome.toLocaleString()} income</span>
                  </div>
                </div>
              )}

              {/* Per-envelope slider rows */}
              <div className="flex flex-col gap-4">
                {envelopes.map((env, idx) => {
                  const Icon = getEnvelopeIcon(env.icon)
                  const sliderMax = env.monthlyAllotment + savings
                  const pct = monthlyIncome > 0 ? Math.round((env.monthlyAllotment / monthlyIncome) * 100) : 0
                  const sliderPct = sliderMax > 0 ? (env.monthlyAllotment / sliderMax) * 100 : 0

                  return (
                    <div
                      key={idx}
                      ref={el => { sliderRowRefs.current[idx] = el }}
                      className={`flex flex-col gap-2 p-3 rounded-xl transition-colors ${
                        activeEnvIdx === idx ? "bg-[#1A1A1A]" : "bg-transparent"
                      }`}
                      onClick={() => setActiveEnvIdx(idx)}
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                          style={{ backgroundColor: `${env.color}22` }}
                        >
                          <Icon className="h-4 w-4" style={{ color: env.color }} />
                        </div>
                        <span className="flex-1 text-sm font-medium text-foreground truncate">{env.name}</span>
                        <div className="flex items-baseline gap-1.5 shrink-0">
                          <span className="text-xs text-muted-foreground">$</span>
                          <input
                            type="number"
                            value={env.monthlyAllotment || ""}
                            onChange={e => {
                              const raw = parseFloat(e.target.value)
                              const clamped = isNaN(raw) ? 0 : Math.min(Math.max(0, raw), sliderMax)
                              setEnvelopes(prev => prev.map((en, i) =>
                                i === idx ? { ...en, monthlyAllotment: clamped } : en,
                              ))
                            }}
                            placeholder="0"
                            min="0"
                            className="w-20 bg-transparent border-b border-[#333] text-right text-foreground text-sm font-semibold py-0.5 focus:outline-none focus:border-[#F7931A] transition-colors [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                          />
                          <span className="text-xs text-muted-foreground w-10 text-right">{pct}%</span>
                        </div>
                      </div>

                      <input
                        type="range"
                        className="alloc-slider"
                        min={0}
                        max={sliderMax}
                        step={50}
                        value={env.monthlyAllotment}
                        onChange={e => {
                          const val = parseInt(e.target.value, 10) || 0
                          setEnvelopes(prev => prev.map((en, i) =>
                            i === idx ? { ...en, monthlyAllotment: val } : en,
                          ))
                        }}
                        onFocus={() => setActiveEnvIdx(idx)}
                        style={{
                          "--slider-color": env.color,
                          "--slider-pct": `${sliderPct}%`,
                        } as React.CSSProperties}
                      />
                    </div>
                  )
                })}
              </div>

              {/* Implicit Savings row */}
              <div className="flex items-center gap-3 p-3 rounded-xl bg-[#1A1A1A]/60 border border-[#1F1F1F]">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-[#22C55E]/10">
                  <PiggyBank className="h-4 w-4 text-[#22C55E]" />
                </div>
                <span className="flex-1 text-sm font-medium text-muted-foreground">Savings</span>
                <div className="flex items-baseline gap-1.5 shrink-0">
                  <span className="text-sm font-semibold text-[#22C55E]">${savings.toLocaleString()}</span>
                  <span className="text-xs text-muted-foreground w-10 text-right">{savingsPct}%</span>
                </div>
              </div>

              {savings === 0 && totalAllocated > 0 && (
                <p className="text-xs text-amber-400/80 text-center">All income allocated — nothing goes to savings</p>
              )}

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setStep("envelopes")}
                  className="flex-1 py-3 bg-[#1A1A1A] text-foreground rounded-xl font-semibold text-sm hover:bg-[#222] transition-colors border border-[#333] flex items-center justify-center gap-2"
                >
                  <ChevronLeft className="h-4 w-4" /> Back
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-1 py-3 bg-[#F7931A] text-[#0D0D0D] rounded-xl font-semibold text-sm hover:bg-[#F7931A]/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {loading ? "Saving..." : "Continue"}
                  {!loading && <ChevronRight className="h-4 w-4" />}
                </button>
              </div>
            </form>
          )}

          {/* Import Step */}
          {step === "import" && (
            <form onSubmit={e => { e.preventDefault(); handleImport() }} className="flex flex-col gap-6">
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-xl bg-[#06B6D4]/10">
                  <Upload className="h-6 w-6 text-[#06B6D4]" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-foreground">Import Transactions</h2>
                  <p className="text-sm text-muted-foreground">Optionally import history from a CSV</p>
                </div>
              </div>

              <div className="flex flex-col items-center gap-4 p-6 border-2 border-dashed border-[#333] rounded-xl">
                <input
                  type="file"
                  accept=".csv"
                  onChange={e => setImportFile(e.target.files?.[0] || null)}
                  className="text-sm text-muted-foreground file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-[#F7931A] file:text-[#0D0D0D] hover:file:bg-[#F7931A]/90"
                />
                <p className="text-xs text-muted-foreground text-center">
                  CSV should have columns: Date, Envelope, Name, Amount
                </p>
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setStep("allocations")}
                  className="flex-1 py-3 bg-[#1A1A1A] text-foreground rounded-xl font-semibold text-sm hover:bg-[#222] transition-colors border border-[#333] flex items-center justify-center gap-2"
                >
                  <ChevronLeft className="h-4 w-4" /> Back
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-1 py-3 bg-[#F7931A] text-[#0D0D0D] rounded-xl font-semibold text-sm hover:bg-[#F7931A]/90 transition-colors disabled:opacity-50"
                >
                  {loading ? "Importing..." : importFile ? "Import & Continue" : "Skip"}
                </button>
              </div>
            </form>
          )}

          {/* Complete Step */}
          {step === "complete" && (
            <form onSubmit={e => { e.preventDefault(); handleComplete() }} className="flex flex-col items-center gap-6 py-4">
              <div className="p-4 rounded-full bg-[#22C55E]/10">
                <svg className="h-10 w-10 text-[#22C55E]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h2 className="text-2xl font-bold text-foreground">You&apos;re All Set!</h2>
              <p className="text-sm text-muted-foreground text-center">
                Your envelopes are ready and your data is secured.
                {importResult && ` Imported ${importResult.imported} transactions.`}
              </p>
              {importResult && importResult.newEnvelopes.length > 0 && (
                <p className="text-xs text-muted-foreground text-center">
                  New envelopes created from import: {importResult.newEnvelopes.join(", ")}
                </p>
              )}
              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 bg-[#F7931A] text-[#0D0D0D] rounded-xl font-semibold text-sm hover:bg-[#F7931A]/90 transition-colors disabled:opacity-50"
              >
                {loading ? "Finishing..." : "Go to Dashboard"}
              </button>
            </form>
          )}
        </div>
      </div>
      <CSVImportDialog
        open={importDialogOpen}
        onOpenChange={handleImportDialogClose}
        file={importFile}
      />
    </div>
  )
}
