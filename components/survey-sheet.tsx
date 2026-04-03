"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
} from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import type { SurveyTriggerType } from "@/lib/survey-eligibility"

/** Once per browser session; eligibility itself comes from GET /api/user/survey (server + computeSurveyEligibility). */
const SESSION_SHOWN_KEY = "bitbudget-survey-shown"
const REFERRER_TRIGGER_KEY = "bitbudget-survey-referrer"

type Eligibility = {
  eligible: boolean
  triggerType: SurveyTriggerType | null
  resumeStep: number
}

export function SurveySheetHost() {
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState(1)
  const [triggerType, setTriggerType] = useState<SurveyTriggerType>("general")
  const [localRating, setLocalRating] = useState<string | null>(null)
  const [textDraft, setTextDraft] = useState("")
  const [loading, setLoading] = useState(false)
  const skipDismissRef = useRef(false)

  const loadAndMaybeOpen = useCallback(async () => {
    try {
      if (typeof sessionStorage !== "undefined" && sessionStorage.getItem(SESSION_SHOWN_KEY) === "1") {
        return
      }
      const refTrig =
        typeof sessionStorage !== "undefined" && sessionStorage.getItem(REFERRER_TRIGGER_KEY) === "1"
      const res = await fetch("/api/user/survey", {
        headers: refTrig ? { "x-bitbudget-survey-referrer": "1" } : undefined,
      })
      if (!res.ok) return
      const data = (await res.json()) as {
        survey: {
          completedAt: string | null
          dismissType: string | null
          currentStep: number
          rating: string | null
        } | null
        eligibility: Eligibility
      }
      if (data.survey?.completedAt || data.survey?.dismissType === "never") return
      if (!data.eligibility.eligible) return
      if (typeof sessionStorage !== "undefined") {
        sessionStorage.setItem(SESSION_SHOWN_KEY, "1")
        sessionStorage.removeItem(REFERRER_TRIGGER_KEY)
      }
      setTriggerType(data.eligibility.triggerType ?? "general")
      const resume =
        data.survey && !data.survey.completedAt && data.survey.currentStep >= 1
          ? data.survey.currentStep
          : data.eligibility.resumeStep
      setStep(resume)
      setLocalRating(data.survey?.rating ?? null)
      setOpen(true)
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    const t = window.setTimeout(() => {
      void loadAndMaybeOpen()
    }, 1200)
    return () => window.clearTimeout(t)
  }, [loadAndMaybeOpen])

  const dismissLater = async () => {
    setLoading(true)
    try {
      await fetch("/api/user/survey/dismiss", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "later" }),
      })
    } catch {
      /* ignore */
    } finally {
      setLoading(false)
      setOpen(false)
    }
  }

  const dismissNever = async () => {
    setLoading(true)
    try {
      await fetch("/api/user/survey/dismiss", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "never" }),
      })
    } catch {
      /* ignore */
    } finally {
      setLoading(false)
    }
    skipDismissRef.current = true
    setOpen(false)
  }

  const closeWithoutDismiss = () => {
    skipDismissRef.current = true
    setOpen(false)
  }

  const submitStep = async (opts: { skip?: boolean; value?: unknown }) => {
    setLoading(true)
    try {
      const res = await fetch("/api/user/survey", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          step,
          skip: opts.skip === true,
          value: opts.value,
          triggerType,
        }),
      })
      if (!res.ok) return
      const data = (await res.json()) as {
        survey: {
          currentStep: number
          completedAt: string | null
          rating: string | null
        }
      }
      const s = data.survey
      if (s.rating) setLocalRating(s.rating)
      if (s.completedAt) {
        closeWithoutDismiss()
        return
      }
      // Step 6 "Done" with all skips leaves completedAt null; still close the sheet.
      if (step === 6) {
        closeWithoutDismiss()
        return
      }
      setStep(s.currentStep)
      setTextDraft("")
    } finally {
      setLoading(false)
    }
  }

  const handleOpenChange = (v: boolean) => {
    if (v) {
      setOpen(true)
      return
    }
    setOpen(false)
    if (skipDismissRef.current) {
      skipDismissRef.current = false
      return
    }
    void dismissLater()
  }

  const step2Prompt =
    localRating === "down"
      ? "What’s your least favorite thing about the app?"
      : "What’s your favorite feature or thing about the app?"
  const step3Prompt =
    localRating === "down"
      ? "What’s your favorite feature or thing about the app?"
      : "What’s your least favorite thing about the app?"

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto rounded-t-2xl border-[#333] bg-[#0D0D0D]">
        <SheetHeader>
          <SheetTitle className="text-foreground">Quick feedback (step {step} of 6)</SheetTitle>
        </SheetHeader>
        <div className="px-4 py-4 space-y-4">
          {step === 1 && (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">How&apos;s BitBudget working for you?</p>
              <div className="flex gap-3 justify-center">
                <Button
                  type="button"
                  variant="outline"
                  className="border-[#333]"
                  onClick={() => void submitStep({ value: "up" })}
                  disabled={loading}
                >
                  Thumbs up
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="border-[#333]"
                  onClick={() => void submitStep({ value: "down" })}
                  disabled={loading}
                >
                  Thumbs down
                </Button>
              </div>
            </div>
          )}
          {step === 2 && (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">{step2Prompt}</p>
              <Textarea
                value={textDraft}
                onChange={e => setTextDraft(e.target.value)}
                className="bg-[#1A1A1A] border-[#333]"
                rows={3}
              />
            </div>
          )}
          {step === 3 && (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">{step3Prompt}</p>
              <Textarea
                value={textDraft}
                onChange={e => setTextDraft(e.target.value)}
                className="bg-[#1A1A1A] border-[#333]"
                rows={3}
              />
            </div>
          )}
          {step === 4 && (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">General comments or suggestions</p>
              <Textarea
                value={textDraft}
                onChange={e => setTextDraft(e.target.value)}
                className="bg-[#1A1A1A] border-[#333]"
                rows={4}
              />
            </div>
          )}
          {step === 5 && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">Can we reach out to learn more?</p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" onClick={() => void submitStep({ value: true })} disabled={loading}>
                  Yes
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="border-[#333]"
                  onClick={() => void submitStep({ value: false })}
                  disabled={loading}
                >
                  No
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="text-muted-foreground"
                  onClick={() => void submitStep({ skip: true })}
                  disabled={loading}
                >
                  Skip
                </Button>
              </div>
            </div>
          )}
          {step === 6 && (
            <p className="text-sm text-center text-muted-foreground py-4">Thanks for your feedback!</p>
          )}
        </div>
        <SheetFooter className="flex-col gap-2 sm:flex-col border-t border-[#333] pt-4">
          {step === 1 && (
            <Button
              type="button"
              variant="ghost"
              className="text-muted-foreground"
              disabled={loading}
              onClick={() => void submitStep({ skip: true })}
            >
              Skip
            </Button>
          )}
          {(step === 2 || step === 3 || step === 4) && (
            <div className="flex gap-2 w-full">
              <Button
                type="button"
                variant="secondary"
                className="flex-1"
                disabled={loading}
                onClick={() => void submitStep({ skip: true })}
              >
                Skip
              </Button>
              <Button
                type="button"
                className="flex-1 bg-[#F7931A] text-[#0D0D0D]"
                disabled={loading || !textDraft.trim()}
                onClick={() => void submitStep({ value: textDraft })}
              >
                Next
              </Button>
            </div>
          )}
          {step === 6 && (
            <Button type="button" className="w-full bg-[#F7931A] text-[#0D0D0D]" disabled={loading} onClick={() => void submitStep({})}>
              Done
            </Button>
          )}
          <div className="flex gap-2 w-full text-xs justify-center pt-2">
            <button type="button" className="text-muted-foreground underline" onClick={() => dismissNever()} disabled={loading}>
              Don&apos;t ask again
            </button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
