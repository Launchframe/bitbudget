/**
 * Financial Runway monthly checkup builder.
 *
 * `buildRunwayCheckup(input)` is a pure function: given already-computed input
 * numbers it returns a structured, phase-specific report made of sections and
 * "facts" — plain data (labels + raw numbers + a tone), never JSX. The UI layer
 * (built later) formats the numbers (USD / sats / %) and renders the bullets.
 *
 * A5 is a standalone slice: it must NOT import from the (separately proposed)
 * runway-need, runway-gap, or expense-insight modules. All need / gap /
 * insight-shaped inputs are re-declared here as local DTOs so this slice lands
 * independently. The caller feeds in the already-projected figures.
 *
 * This module is pure and does no I/O, so it never logs anything.
 */

import { roundToCents } from "@/lib/decimal-validation"

// ---------------------------------------------------------------------------
// Phase + shared value shapes
// ---------------------------------------------------------------------------

export const CHECKUP_PHASES = ["buildup", "runway"] as const
export type CheckupPhase = (typeof CHECKUP_PHASES)[number]

/** A projected value under the three standard assumptions. */
export interface CheckupProjection {
  /** Flat / current-price assumption. */
  spot: number
  /** Stressed (price-drop) assumption. */
  stress: number
  /** Growth assumption. */
  growth: number
}

// ---------------------------------------------------------------------------
// Local DTOs for need / gap / insight-shaped inputs (do NOT import A1–A4)
// ---------------------------------------------------------------------------

/** A planned spending line as the checkup consumes it. */
export interface CheckupPlannedLine {
  id: string
  label: string
  /** New monthly cost this line introduces. */
  monthlyUsd: number
  /** "add" = on top of today's costs; "replaces" = swaps an existing cost. */
  mode: "add" | "replaces"
  /** For "replaces": the prior monthly average being swapped out. */
  replacesMonthlyUsd?: number
}

/** A flexible envelope that overspent its allotment this month. */
export interface CheckupHotEnvelope {
  envelopeId: string
  name: string
  allottedUsd: number
  spentUsd: number
}

/** A scenario toggle and its monthly / one-time effect. */
export interface CheckupScenario {
  id: string
  label: string
  monthlyDeltaUsd: number
  oneTimeUsd: number
  enabled: boolean
}

/** Savings-goal outcome for the month. */
export interface CheckupSavingsGoal {
  targetUsd: number
  actualUsd: number
}

/** One planned line compared with what was actually spent against it. */
export interface CheckupPlannedActual {
  id: string
  label: string
  plannedMonthlyUsd: number
  actualMonthlyUsd: number
}

/** An open loan summary (the loans module ships later; these are inputs). */
export interface CheckupLoan {
  id: string
  label: string
  monthlyBillUsd: number
  /** Price level at which there is room to sell collateral to cover the loan. */
  roomToSellPriceUsd: number
  /** Whether rolling the loan over covers the upcoming bill. */
  rolloverCovers: boolean
}

// ---------------------------------------------------------------------------
// Input (discriminated union on phase)
// ---------------------------------------------------------------------------

interface CheckupInputBase {
  monthKey: string
}

export interface BuildupCheckupInput extends CheckupInputBase {
  phase: "buildup"
  /** What the plan says is required to be on track. */
  required: { cashUsd: number; bitcoinSats: number }
  /** On-track projected totals under each assumption. */
  projected: { cashUsd: CheckupProjection; bitcoinSats: CheckupProjection }
  /** Share of the stack currently held in bitcoin (0–1). */
  bitcoinShare: number
  /** Target share held in bitcoin (0–1). */
  targetBitcoinShare: number
  /**
   * Today's monthly living costs. The draw section flags each planned line on
   * its own net change; it does not compare that net to this baseline.
   */
  livingCostsMonthlyUsd: number
  plannedLines: CheckupPlannedLine[]
  hotEnvelopes: CheckupHotEnvelope[]
  scenarios: CheckupScenario[]
  /** Horizon in months, used to total each scenario's effect. */
  horizonMonths: number
  /** Savings goal outcome, if a goal was set for the month. */
  savingsGoal?: CheckupSavingsGoal | null
}

export interface RunwayPhaseCheckupInput extends CheckupInputBase {
  phase: "runway"
  plannedActuals: CheckupPlannedActual[]
  /** Months of runway remaining under each assumption. */
  monthsLeft: CheckupProjection
  loans: CheckupLoan[]
  /** A bond / instrument maturing within the planning horizon. */
  maturity: { insideHorizon: boolean; monthsUntilMaturity: number | null }
  /** Income that arrived, expressed as months of stack it let you keep. */
  incomeArrived: { amountUsd: number; monthsOfStackKept: number }
}

export type RunwayCheckupInput = BuildupCheckupInput | RunwayPhaseCheckupInput

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export type CheckupTone = "neutral" | "good" | "warn" | "bad"
export type CheckupUnit = "usd" | "sats" | "percent" | "months" | "count" | "none"

/** One bullet of report data. `value` is a raw number the UI formats by `unit`. */
export interface CheckupFact {
  id: string
  label: string
  value: number | null
  unit: CheckupUnit
  tone: CheckupTone
  /** Optional extra plain-language note (still data, not JSX). */
  detail?: string
}

export interface CheckupSection {
  id: string
  title: string
  facts: CheckupFact[]
}

export interface RunwayCheckup {
  monthKey: string
  phase: CheckupPhase
  sections: CheckupSection[]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Clamp a 0–1 share. Non-finite inputs stay missing so they are not reported as 0%. */
function clampFraction(value: number): number | null {
  if (!Number.isFinite(value)) return null
  if (value < 0) return 0
  if (value > 1) return 1
  return value
}

/**
 * Round for display, then drop non-finite results. `Math.round(Infinity)` is
 * Infinity and `roundToCents(NaN)` is NaN — neither should become a fact value.
 */
function roundedFinite(
  value: number,
  round: (value: number) => number,
): number | null {
  if (!Number.isFinite(value)) return null
  const rounded = round(value)
  return Number.isFinite(rounded) ? rounded : null
}

/** Net monthly contribution a planned line adds to the draw. */
export function plannedLineNetMonthlyUsd(line: CheckupPlannedLine): number {
  if (line.mode === "replaces") {
    return roundToCents(line.monthlyUsd - (line.replacesMonthlyUsd ?? 0))
  }
  return roundToCents(line.monthlyUsd)
}

/** Total lifetime effect of a scenario across the horizon (months + one-time). */
export function scenarioEffectUsd(
  scenario: CheckupScenario,
  horizonMonths: number,
): number {
  if (
    !Number.isFinite(scenario.monthlyDeltaUsd) ||
    !Number.isFinite(scenario.oneTimeUsd) ||
    !Number.isFinite(horizonMonths)
  ) {
    return Number.NaN
  }
  const months = horizonMonths > 0 ? horizonMonths : 0
  return roundToCents(scenario.monthlyDeltaUsd * months + scenario.oneTimeUsd)
}

/**
 * Compare a projected total against the required total using the SAME rounding
 * the UI applies to the displayed `value` (cents for USD, whole sats). Comparing
 * the raw inputs would mark a projection as `bad` even when it rounds to the same
 * number as the target the user sees on screen.
 */
function projectionTone(
  projected: number,
  required: number,
  round: (value: number) => number,
): CheckupTone {
  const projectedRounded = roundedFinite(projected, round)
  const requiredRounded = roundedFinite(required, round)
  // Missing numbers are not "on track" and not a measured shortfall.
  if (projectedRounded == null || requiredRounded == null) return "warn"
  if (projectedRounded >= requiredRounded) return "good"
  return "bad"
}

/** Scenario mood applies only when the month count is a real, non-negative number. */
function monthsLeftTone(value: number | null, whenOk: CheckupTone): CheckupTone {
  if (value == null) return "warn"
  if (value < 0) return "bad"
  return whenOk
}

// ---------------------------------------------------------------------------
// Buildup phase
// ---------------------------------------------------------------------------

function buildBuildupSections(input: BuildupCheckupInput): CheckupSection[] {
  const sections: CheckupSection[] = []

  // 1. Cash + bitcoin targets vs on-track projections.
  const requiredCash = roundedFinite(input.required.cashUsd, roundToCents)
  const requiredBitcoin = roundedFinite(input.required.bitcoinSats, Math.round)
  const cashFacts: CheckupFact[] = [
    {
      id: "required-cash",
      label: "Cash you need to stay on track",
      value: requiredCash,
      unit: "usd",
      tone: requiredCash == null ? "warn" : "neutral",
    },
    {
      id: "projected-cash-spot",
      label: "Projected cash (steady price)",
      value: roundedFinite(input.projected.cashUsd.spot, roundToCents),
      unit: "usd",
      tone: projectionTone(
        input.projected.cashUsd.spot,
        input.required.cashUsd,
        roundToCents,
      ),
    },
    {
      id: "projected-cash-stress",
      label: "Projected cash (price drop)",
      value: roundedFinite(input.projected.cashUsd.stress, roundToCents),
      unit: "usd",
      tone: projectionTone(
        input.projected.cashUsd.stress,
        input.required.cashUsd,
        roundToCents,
      ),
    },
    {
      id: "projected-cash-growth",
      label: "Projected cash (price grows)",
      value: roundedFinite(input.projected.cashUsd.growth, roundToCents),
      unit: "usd",
      tone: projectionTone(
        input.projected.cashUsd.growth,
        input.required.cashUsd,
        roundToCents,
      ),
    },
    {
      id: "required-bitcoin",
      label: "Bitcoin you need to stay on track",
      value: requiredBitcoin,
      unit: "sats",
      tone: requiredBitcoin == null ? "warn" : "neutral",
    },
    {
      id: "projected-bitcoin-spot",
      label: "Projected bitcoin (steady price)",
      value: roundedFinite(input.projected.bitcoinSats.spot, Math.round),
      unit: "sats",
      tone: projectionTone(
        input.projected.bitcoinSats.spot,
        input.required.bitcoinSats,
        Math.round,
      ),
    },
    {
      id: "projected-bitcoin-stress",
      label: "Projected bitcoin (price drop)",
      value: roundedFinite(input.projected.bitcoinSats.stress, Math.round),
      unit: "sats",
      tone: projectionTone(
        input.projected.bitcoinSats.stress,
        input.required.bitcoinSats,
        Math.round,
      ),
    },
    {
      id: "projected-bitcoin-growth",
      label: "Projected bitcoin (price grows)",
      value: roundedFinite(input.projected.bitcoinSats.growth, Math.round),
      unit: "sats",
      tone: projectionTone(
        input.projected.bitcoinSats.growth,
        input.required.bitcoinSats,
        Math.round,
      ),
    },
  ]
  sections.push({
    id: "targets",
    title: "Are you on track?",
    facts: cashFacts,
  })

  // 2. Bitcoin share vs target. Values stay 0–1 fractions; the UI scales percent.
  const held = clampFraction(input.bitcoinShare)
  const target = clampFraction(input.targetBitcoinShare)
  sections.push({
    id: "bitcoin-share",
    title: "How much of your stack is in bitcoin",
    facts: [
      {
        id: "bitcoin-share-held",
        label: "Held in bitcoin now",
        value: held,
        unit: "percent",
        tone:
          held == null || target == null ? "warn" : held >= target ? "good" : "warn",
      },
      {
        id: "bitcoin-share-target",
        label: "Your target for bitcoin",
        value: target,
        unit: "percent",
        tone: target == null ? "warn" : "neutral",
      },
    ],
  })

  // 3. Planned lines whose own net change is an increase. A line we cannot
  // read must not disappear into the "nothing raises the draw" all-clear.
  const drawFacts: CheckupFact[] = []
  for (const line of input.plannedLines) {
    const net = plannedLineNetMonthlyUsd(line)
    if (!Number.isFinite(net)) {
      drawFacts.push({
        id: `draw-line-${line.id}`,
        label: line.label,
        value: null,
        unit: "usd",
        tone: "warn",
        detail: "We couldn't read this planned change",
      })
      continue
    }
    if (net <= 0) continue
    drawFacts.push({
      id: `draw-line-${line.id}`,
      label: line.label,
      value: net,
      unit: "usd",
      tone: "warn",
      detail:
        line.mode === "replaces"
          ? "Costs more than what it replaces"
          : "Adds to your monthly costs",
    })
  }
  if (drawFacts.length === 0) {
    drawFacts.push({
      id: "draw-none",
      label: "No planned changes push your spending above today's costs",
      value: null,
      unit: "none",
      tone: "good",
    })
  }
  sections.push({
    id: "draw",
    title: "What makes your future spending bigger than today",
    facts: drawFacts,
  })

  // 4. Flexible envelopes that ran hot (+ prompt). Tone follows the rounded
  // overspend, so a fraction of a cent does not read as over budget.
  const hotFacts: CheckupFact[] = []
  for (const env of input.hotEnvelopes) {
    const over = roundedFinite(env.spentUsd - env.allottedUsd, roundToCents)
    if (over == null) {
      hotFacts.push({
        id: `hot-${env.envelopeId}`,
        label: env.name,
        value: null,
        unit: "usd",
        tone: "warn",
        detail: "We couldn't read this envelope",
      })
      continue
    }
    if (over <= 0) continue
    hotFacts.push({
      id: `hot-${env.envelopeId}`,
      label: env.name,
      value: over,
      unit: "usd",
      tone: "bad",
      detail: "Spent more than you set aside",
    })
  }
  if (hotFacts.length > 0) {
    hotFacts.push({
      id: "hot-prompt",
      label: "Jot down what drove the overspending so next month is easier",
      value: null,
      unit: "none",
      tone: "neutral",
    })
  } else {
    hotFacts.push({
      id: "hot-none",
      label: "Every flexible envelope stayed within its limit",
      value: null,
      unit: "none",
      tone: "good",
    })
  }
  sections.push({
    id: "hot-envelopes",
    title: "Flexible envelopes that ran hot",
    facts: hotFacts,
  })

  // 5. Scenario effects over the horizon.
  const scenarioFacts: CheckupFact[] = input.scenarios.map((scenario) => {
    const effect = scenarioEffectUsd(scenario, input.horizonMonths)
    const value = Number.isFinite(effect) ? effect : null
    let tone: CheckupTone = "neutral"
    if (value == null || scenario.enabled) tone = "warn"
    return {
      id: `scenario-${scenario.id}`,
      label: scenario.label,
      value,
      unit: "usd",
      tone,
      detail:
        value == null
          ? "We couldn't total this"
          : scenario.enabled
            ? "Turned on"
            : "Turned off",
    }
  })
  if (scenarioFacts.length === 0) {
    scenarioFacts.push({
      id: "scenario-none",
      label: "No what-if scenarios added yet",
      value: null,
      unit: "none",
      tone: "neutral",
    })
  }
  sections.push({
    id: "scenarios",
    title: "What each what-if would cost over your horizon",
    facts: scenarioFacts,
  })

  // 6. Savings goal met or missed.
  if (input.savingsGoal) {
    const target = roundedFinite(input.savingsGoal.targetUsd, roundToCents)
    const actual = roundedFinite(input.savingsGoal.actualUsd, roundToCents)
    if (target == null || actual == null) {
      sections.push({
        id: "savings-goal",
        title: "Your savings goal this month",
        facts: [
          {
            id: "savings-goal-outcome",
            label: "We couldn't read this goal",
            value: null,
            unit: "usd",
            tone: "warn",
          },
        ],
      })
    } else {
      const met = actual >= target
      sections.push({
        id: "savings-goal",
        title: "Your savings goal this month",
        facts: [
          {
            id: "savings-goal-outcome",
            label: met ? "Goal met" : "Goal missed",
            value: actual,
            unit: "usd",
            tone: met ? "good" : "bad",
            detail: met
              ? "You saved at least your target"
              : "You saved less than your target",
          },
          {
            id: "savings-goal-target",
            label: "Your target",
            value: target,
            unit: "usd",
            tone: "neutral",
          },
        ],
      })
    }
  }

  return sections
}

// ---------------------------------------------------------------------------
// Runway phase
// ---------------------------------------------------------------------------

function buildRunwaySections(input: RunwayPhaseCheckupInput): CheckupSection[] {
  const sections: CheckupSection[] = []

  // 1. Each planned line vs actual spent.
  const plannedFacts: CheckupFact[] = input.plannedActuals.map((row) => {
    const actual = roundedFinite(row.actualMonthlyUsd, roundToCents)
    const planned = roundedFinite(row.plannedMonthlyUsd, roundToCents)
    if (actual == null || planned == null) {
      return {
        id: `planned-actual-${row.id}`,
        label: row.label,
        value: null,
        unit: "usd" as const,
        tone: "warn" as const,
        detail: "We couldn't compare this line",
      }
    }
    const diff = roundToCents(actual - planned)
    return {
      id: `planned-actual-${row.id}`,
      label: row.label,
      value: diff,
      unit: "usd" as const,
      tone: diff > 0 ? ("bad" as const) : ("good" as const),
      detail:
        diff > 0
          ? "Over what you planned"
          : diff < 0
            ? "Under what you planned"
            : "Right on plan",
    }
  })
  if (plannedFacts.length === 0) {
    plannedFacts.push({
      id: "planned-actual-none",
      label: "No planned lines to compare yet",
      value: null,
      unit: "none",
      tone: "neutral",
    })
  }
  sections.push({
    id: "planned-vs-actual",
    title: "Your plan vs what you actually spent",
    facts: plannedFacts,
  })

  // 2. Months of runway left under each assumption.
  const monthsSpot = Number.isFinite(input.monthsLeft.spot) ? input.monthsLeft.spot : null
  const monthsStress = Number.isFinite(input.monthsLeft.stress)
    ? input.monthsLeft.stress
    : null
  const monthsGrowth = Number.isFinite(input.monthsLeft.growth)
    ? input.monthsLeft.growth
    : null
  sections.push({
    id: "months-left",
    title: "How long your money lasts",
    facts: [
      {
        id: "months-left-spot",
        label: "Months left (steady price)",
        value: monthsSpot,
        unit: "months",
        tone: monthsLeftTone(monthsSpot, "neutral"),
      },
      {
        id: "months-left-stress",
        label: "Months left (price drop)",
        value: monthsStress,
        unit: "months",
        tone: monthsLeftTone(monthsStress, "warn"),
      },
      {
        id: "months-left-growth",
        label: "Months left (price grows)",
        value: monthsGrowth,
        unit: "months",
        tone: monthsLeftTone(monthsGrowth, "good"),
      },
    ],
  })

  // 3. Open loans summary.
  const loanFacts: CheckupFact[] = []
  for (const loan of input.loans) {
    const bill = roundedFinite(loan.monthlyBillUsd, roundToCents)
    const sell = roundedFinite(loan.roomToSellPriceUsd, roundToCents)
    loanFacts.push({
      id: `loan-bill-${loan.id}`,
      label: `${loan.label}: monthly bill`,
      value: bill,
      unit: "usd",
      tone: bill == null ? "warn" : "neutral",
    })
    loanFacts.push({
      id: `loan-sell-${loan.id}`,
      label: `${loan.label}: room to sell at`,
      value: sell,
      unit: "usd",
      tone: sell == null ? "warn" : "neutral",
    })
    loanFacts.push({
      id: `loan-rollover-${loan.id}`,
      label: loan.rolloverCovers
        ? `${loan.label}: rolling over covers the bill`
        : `${loan.label}: rolling over does not cover the bill`,
      value: null,
      unit: "none",
      tone: loan.rolloverCovers ? "good" : "warn",
    })
  }
  if (loanFacts.length === 0) {
    loanFacts.push({
      id: "loan-none",
      label: "No open loans",
      value: null,
      unit: "none",
      tone: "good",
    })
  }
  sections.push({ id: "loans", title: "Open loans", facts: loanFacts })

  // 4. Maturity inside horizon callout.
  if (input.maturity.insideHorizon) {
    const monthsUntil = input.maturity.monthsUntilMaturity
    const monthsValue =
      monthsUntil != null && Number.isFinite(monthsUntil) ? monthsUntil : null
    const monthsUnreadable = monthsUntil != null && !Number.isFinite(monthsUntil)
    sections.push({
      id: "maturity",
      title: "Something matures inside your window",
      facts: [
        {
          id: "maturity-callout",
          label: "A holding matures before your horizon ends",
          value: monthsValue,
          unit: monthsValue == null ? "none" : "months",
          tone: monthsUnreadable || (monthsValue != null && monthsValue < 0) ? "warn" : "good",
          detail: "Plan for the cash it frees up",
        },
      ],
    })
  }

  // 5. Income that arrived, as months of stack kept.
  const incomeAmount = roundedFinite(input.incomeArrived.amountUsd, roundToCents)
  const incomeMonths = Number.isFinite(input.incomeArrived.monthsOfStackKept)
    ? input.incomeArrived.monthsOfStackKept
    : null
  const keptStack =
    incomeAmount != null && incomeAmount > 0 && incomeMonths != null && incomeMonths > 0
  sections.push({
    id: "income-arrived",
    title: "Income you brought in",
    facts: [
      {
        id: "income-arrived-amount",
        label: "Money that came in",
        value: incomeAmount,
        unit: "usd",
        tone: incomeAmount == null || incomeAmount < 0 ? "warn" : "good",
      },
      {
        id: "income-arrived-months",
        label: "Months of your stack that kept",
        value: incomeMonths,
        unit: "months",
        tone: incomeMonths == null || incomeMonths < 0 ? "warn" : "good",
        ...(keptStack
          ? { detail: "Earning this let you avoid spending down your savings" }
          : {}),
      },
    ],
  })

  return sections
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Build a structured monthly checkup report from already-computed inputs. Pure:
 * no I/O, no logging, no decryption. The returned sections are data only; the
 * UI formats numbers by `unit` and renders the labels as bullets.
 */
export function buildRunwayCheckup(input: RunwayCheckupInput): RunwayCheckup {
  switch (input.phase) {
    case "buildup":
      return {
        monthKey: input.monthKey,
        phase: "buildup",
        sections: buildBuildupSections(input),
      }
    case "runway":
      return {
        monthKey: input.monthKey,
        phase: "runway",
        sections: buildRunwaySections(input),
      }
    default: {
      const _exhaustive: never = input
      return _exhaustive
    }
  }
}
