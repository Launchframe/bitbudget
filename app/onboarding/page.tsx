"use client"

import { useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import { BitbudgetLogo } from "@/components/bitbudget-logo"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { Plus, Trash2, ChevronRight, ChevronLeft, Lock, Wallet, DollarSign, PieChart, Upload } from "lucide-react"
import {
  deriveKeyFromPin,
  generateSalt,
  generatePrivacyKey,
  encryptPrivacyKey,
  uint8ToHex,
} from "@/lib/crypto"

type Step = "security" | "income" | "envelopes" | "allocations" | "import" | "complete"

const STEPS: Step[] = ["security", "income", "envelopes", "allocations", "import", "complete"]
const ENVELOPE_COLORS = ["#F7931A", "#3B82F6", "#10B981", "#8B5CF6", "#EF4444", "#EAB308", "#EC4899", "#06B6D4"]

interface DraftEnvelope {
  name: string
  color: string
  monthlyAllotment: number
}

export default function OnboardingPage() {
  const router = useRouter()
  const [step, setStep] = useState<Step>("security")
  const [loading, setLoading] = useState(false)
  const [isNostr, setIsNostr] = useState(false)

  // Security
  const [pin, setPin] = useState("")
  const [pinConfirm, setPinConfirm] = useState("")
  const [pinError, setPinError] = useState("")

  // Income
  const [income, setIncome] = useState("")
  const [cadence, setCadence] = useState<"monthly" | "bimonthly">("monthly")

  // Envelopes
  const [envelopes, setEnvelopes] = useState<DraftEnvelope[]>([
    { name: "Rent", color: ENVELOPE_COLORS[0], monthlyAllotment: 0 },
    { name: "Food", color: ENVELOPE_COLORS[2], monthlyAllotment: 0 },
    { name: "Transportation", color: ENVELOPE_COLORS[4], monthlyAllotment: 0 },
  ])
  const [newEnvName, setNewEnvName] = useState("")

  // Import
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importResult, setImportResult] = useState<{ imported: number; skipped: number; newEnvelopes: string[] } | null>(null)

  const stepIndex = STEPS.indexOf(step)
  const progress = ((stepIndex + 1) / STEPS.length) * 100

  const checkIfNostr = useCallback(async () => {
    try {
      const res = await fetch("/api/user/encryption")
      const data = await res.json()
      if (data.isNostr) {
        setIsNostr(true)
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
    setEnvelopes(prev => [
      ...prev,
      {
        name: newEnvName.trim(),
        color: ENVELOPE_COLORS[prev.length % ENVELOPE_COLORS.length],
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
          body: JSON.stringify(env),
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

  async function handleImport() {
    if (!importFile) { setStep("complete"); return }
    setLoading(true)
    try {
      const formData = new FormData()
      formData.append("file", importFile)
      const res = await fetch("/api/import", { method: "POST", body: formData })
      const data = await res.json()
      setImportResult(data)
      setStep("complete")
    } finally {
      setLoading(false)
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
  const unallocated = monthlyIncome - totalAllocated

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
            <div className="flex flex-col gap-6">
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
                onClick={handleSecuritySetup}
                disabled={loading || !pin || !pinConfirm}
                className="w-full py-3 bg-[#F7931A] text-[#0D0D0D] rounded-xl font-semibold text-sm hover:bg-[#F7931A]/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {loading ? "Setting up..." : "Continue"}
                {!loading && <ChevronRight className="h-4 w-4" />}
              </button>
            </div>
          )}

          {/* Income Step */}
          {step === "income" && (
            <div className="flex flex-col gap-6">
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
                onClick={handleIncomeSave}
                disabled={loading || !income}
                className="w-full py-3 bg-[#F7931A] text-[#0D0D0D] rounded-xl font-semibold text-sm hover:bg-[#F7931A]/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {loading ? "Saving..." : "Continue"}
                {!loading && <ChevronRight className="h-4 w-4" />}
              </button>
            </div>
          )}

          {/* Envelopes Step */}
          {step === "envelopes" && (
            <div className="flex flex-col gap-6">
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
                {envelopes.map((env, idx) => (
                  <div key={idx} className="flex items-center gap-3 p-3 bg-[#1A1A1A] rounded-xl">
                    <div className="w-4 h-4 rounded-full shrink-0" style={{ backgroundColor: env.color }} />
                    <span className="flex-1 text-sm font-medium text-foreground">{env.name}</span>
                    <button
                      onClick={() => removeEnvelope(idx)}
                      className="p-1 text-muted-foreground hover:text-red-400 transition-colors"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
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
                  onClick={addEnvelope}
                  disabled={!newEnvName.trim()}
                  className="px-4 py-2 bg-[#1A1A1A] border border-[#333] text-foreground rounded-lg hover:bg-[#222] transition-colors disabled:opacity-30"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setStep("income")}
                  className="flex-1 py-3 bg-[#1A1A1A] text-foreground rounded-xl font-semibold text-sm hover:bg-[#222] transition-colors border border-[#333] flex items-center justify-center gap-2"
                >
                  <ChevronLeft className="h-4 w-4" /> Back
                </button>
                <button
                  onClick={handleEnvelopesSave}
                  disabled={loading || envelopes.length === 0}
                  className="flex-1 py-3 bg-[#F7931A] text-[#0D0D0D] rounded-xl font-semibold text-sm hover:bg-[#F7931A]/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {loading ? "Saving..." : "Continue"}
                  {!loading && <ChevronRight className="h-4 w-4" />}
                </button>
              </div>
            </div>
          )}

          {/* Allocations Step */}
          {step === "allocations" && (
            <div className="flex flex-col gap-6">
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-xl bg-[#3B82F6]/10">
                  <PieChart className="h-6 w-6 text-[#3B82F6]" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-foreground">Allocate Income</h2>
                  <p className="text-sm text-muted-foreground">Distribute ${monthlyIncome.toLocaleString()} across envelopes</p>
                </div>
              </div>

              <div className="flex items-center justify-between p-3 rounded-xl bg-[#1A1A1A]">
                <span className="text-sm text-muted-foreground">Unallocated</span>
                <span className={`text-lg font-bold ${unallocated >= 0 ? "text-[#22C55E]" : "text-[#EF4444]"}`}>
                  ${unallocated.toLocaleString()}
                </span>
              </div>

              <div className="flex flex-col gap-3">
                {envelopes.map((env, idx) => (
                  <div key={idx} className="flex items-center gap-3">
                    <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: env.color }} />
                    <span className="text-sm font-medium text-foreground w-32 truncate">{env.name}</span>
                    <div className="relative flex-1">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                      <Input
                        type="number"
                        value={env.monthlyAllotment || ""}
                        onChange={e => {
                          const val = parseFloat(e.target.value) || 0
                          setEnvelopes(prev => prev.map((en, i) =>
                            i === idx ? { ...en, monthlyAllotment: val } : en,
                          ))
                        }}
                        placeholder="0"
                        className="bg-[#1A1A1A] border-[#333] text-foreground placeholder:text-[#555] pl-7 h-9 text-sm"
                        min="0"
                        step="50"
                      />
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setStep("envelopes")}
                  className="flex-1 py-3 bg-[#1A1A1A] text-foreground rounded-xl font-semibold text-sm hover:bg-[#222] transition-colors border border-[#333] flex items-center justify-center gap-2"
                >
                  <ChevronLeft className="h-4 w-4" /> Back
                </button>
                <button
                  onClick={handleAllocationsSave}
                  disabled={loading}
                  className="flex-1 py-3 bg-[#F7931A] text-[#0D0D0D] rounded-xl font-semibold text-sm hover:bg-[#F7931A]/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {loading ? "Saving..." : "Continue"}
                  {!loading && <ChevronRight className="h-4 w-4" />}
                </button>
              </div>
            </div>
          )}

          {/* Import Step */}
          {step === "import" && (
            <div className="flex flex-col gap-6">
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
                  onClick={() => setStep("allocations")}
                  className="flex-1 py-3 bg-[#1A1A1A] text-foreground rounded-xl font-semibold text-sm hover:bg-[#222] transition-colors border border-[#333] flex items-center justify-center gap-2"
                >
                  <ChevronLeft className="h-4 w-4" /> Back
                </button>
                <button
                  onClick={handleImport}
                  disabled={loading}
                  className="flex-1 py-3 bg-[#F7931A] text-[#0D0D0D] rounded-xl font-semibold text-sm hover:bg-[#F7931A]/90 transition-colors disabled:opacity-50"
                >
                  {loading ? "Importing..." : importFile ? "Import & Continue" : "Skip"}
                </button>
              </div>
            </div>
          )}

          {/* Complete Step */}
          {step === "complete" && (
            <div className="flex flex-col items-center gap-6 py-4">
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
                onClick={handleComplete}
                disabled={loading}
                className="w-full py-3 bg-[#F7931A] text-[#0D0D0D] rounded-xl font-semibold text-sm hover:bg-[#F7931A]/90 transition-colors disabled:opacity-50"
              >
                {loading ? "Finishing..." : "Go to Dashboard"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
