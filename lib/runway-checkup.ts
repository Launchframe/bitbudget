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
  /** Today's monthly living costs, for the "draw larger than today" check. */
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

function clampFraction(value: number): number {
  if (!Number.isFinite(value)) return 0
  if (value < 0) return 0
  if (value > 1) return 1
  return value
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
  const months = Number.isFinite(horizonMonths) && horizonMonths > 0 ? horizonMonths : 0
  return roundToCents(scenario.monthlyDeltaUsd * months + scenario.oneTimeUsd)
}

function projectionTone(projected: number, required: number): CheckupTone {
  if (projected >= required) return "good"
  return "bad"
}

// ---------------------------------------------------------------------------
// Buildup phase
// ---------------------------------------------------------------------------

function buildBuildupSections(input: BuildupCheckupInput): CheckupSection[] {
  const sections: CheckupSection[] = []

  // 1. Cash + bitcoin targets vs on-track projections.
  const cashFacts: CheckupFact[] = [
    {
      id: "required-cash",
      label: "Cash you need to stay on track",
      value: roundToCents(input.required.cashUsd),
      unit: "usd",
      tone: "neutral",
    },
    {
      id: "projected-cash-spot",
      label: "Projected cash (steady price)",
      value: roundToCents(input.projected.cashUsd.spot),
      unit: "usd",
      tone: projectionTone(input.projected.cashUsd.spot, input.required.cashUsd),
    },
    {
      id: "projected-cash-stress",
      label: "Projected cash (price drop)",
      value: roundToCents(input.projected.cashUsd.stress),
      unit: "usd",
      tone: projectionTone(input.projected.cashUsd.stress, input.required.cashUsd),
    },
    {
      id: "projected-cash-growth",
      label: "Projected cash (price grows)",
      value: roundToCents(input.projected.cashUsd.growth),
      unit: "usd",
      tone: projectionTone(input.projected.cashUsd.growth, input.required.cashUsd),
    },
    {
      id: "required-bitcoin",
      label: "Bitcoin you need to stay on track",
      value: Math.round(input.required.bitcoinSats),
      unit: "sats",
      tone: "neutral",
    },
    {
      id: "projected-bitcoin-spot",
      label: "Projected bitcoin (steady price)",
      value: Math.round(input.projected.bitcoinSats.spot),
      unit: "sats",
      tone: projectionTone(
        input.projected.bitcoinSats.spot,
        input.required.bitcoinSats,
      ),
    },
    {
      id: "projected-bitcoin-stress",
      label: "Projected bitcoin (price drop)",
      value: Math.round(input.projected.bitcoinSats.stress),
      unit: "sats",
      tone: projectionTone(
        input.projected.bitcoinSats.stress,
        input.required.bitcoinSats,
      ),
    },
    {
      id: "projected-bitcoin-growth",
      label: "Projected bitcoin (price grows)",
      value: Math.round(input.projected.bitcoinSats.growth),
      unit: "sats",
      tone: projectionTone(
        input.projected.bitcoinSats.growth,
        input.required.bitcoinSats,
      ),
    },
  ]
  sections.push({
    id: "targets",
    title: "Are you on track?",
    facts: cashFacts,
  })

  // 2. Bitcoin share vs target.
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
        tone: held >= target ? "good" : "warn",
      },
      {
        id: "bitcoin-share-target",
        label: "Your target for bitcoin",
        value: target,
        unit: "percent",
        tone: "neutral",
      },
    ],
  })

  // 3. Planned lines that make the draw larger than today's living costs.
  const raisingLines = input.plannedLines
    .map((line) => ({ line, net: plannedLineNetMonthlyUsd(line) }))
    .filter(({ net }) => net > 0)
  const drawFacts: CheckupFact[] = raisingLines.map(({ line, net }) => ({
    id: `draw-line-${line.id}`,
    label: line.label,
    value: net,
    unit: "usd",
    tone: "warn",
    detail:
      line.mode === "replaces"
        ? "Costs more than what it replaces"
        : "Adds to your monthly costs",
  }))
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

  // 4. Flexible envelopes that ran hot (+ prompt).
  const hotFacts: CheckupFact[] = input.hotEnvelopes.map((env) => ({
    id: `hot-${env.envelopeId}`,
    label: env.name,
    value: roundToCents(env.spentUsd - env.allottedUsd),
    unit: "usd",
    tone: "bad",
    detail: "Spent more than you set aside",
  }))
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
  const scenarioFacts: CheckupFact[] = input.scenarios.map((scenario) => ({
    id: `scenario-${scenario.id}`,
    label: scenario.label,
    value: scenarioEffectUsd(scenario, input.horizonMonths),
    unit: "usd",
    tone: scenario.enabled ? "warn" : "neutral",
    detail: scenario.enabled ? "Turned on" : "Turned off",
  }))
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
    const target = roundToCents(input.savingsGoal.targetUsd)
    const actual = roundToCents(input.savingsGoal.actualUsd)
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

  return sections
}

// ---------------------------------------------------------------------------
// Runway phase
// ---------------------------------------------------------------------------

function buildRunwaySections(input: RunwayPhaseCheckupInput): CheckupSection[] {
  const sections: CheckupSection[] = []

  // 1. Each planned line vs actual spent.
  const plannedFacts: CheckupFact[] = input.plannedActuals.map((row) => {
    const diff = roundToCents(row.actualMonthlyUsd - row.plannedMonthlyUsd)
    return {
      id: `planned-actual-${row.id}`,
      label: row.label,
      value: diff,
      unit: "usd",
      tone: diff > 0 ? "bad" : "good",
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
  sections.push({
    id: "months-left",
    title: "How long your money lasts",
    facts: [
      {
        id: "months-left-spot",
        label: "Months left (steady price)",
        value: input.monthsLeft.spot,
        unit: "months",
        tone: "neutral",
      },
      {
        id: "months-left-stress",
        label: "Months left (price drop)",
        value: input.monthsLeft.stress,
        unit: "months",
        tone: "warn",
      },
      {
        id: "months-left-growth",
        label: "Months left (price grows)",
        value: input.monthsLeft.growth,
        unit: "months",
        tone: "good",
      },
    ],
  })

  // 3. Open loans summary.
  const loanFacts: CheckupFact[] = []
  for (const loan of input.loans) {
    loanFacts.push({
      id: `loan-bill-${loan.id}`,
      label: `${loan.label}: monthly bill`,
      value: roundToCents(loan.monthlyBillUsd),
      unit: "usd",
      tone: "neutral",
    })
    loanFacts.push({
      id: `loan-sell-${loan.id}`,
      label: `${loan.label}: room to sell at`,
      value: roundToCents(loan.roomToSellPriceUsd),
      unit: "usd",
      tone: "neutral",
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
    sections.push({
      id: "maturity",
      title: "Something matures inside your window",
      facts: [
        {
          id: "maturity-callout",
          label: "A holding matures before your horizon ends",
          value: input.maturity.monthsUntilMaturity,
          unit:
            input.maturity.monthsUntilMaturity == null ? "none" : "months",
          tone: "good",
          detail: "Plan for the cash it frees up",
        },
      ],
    })
  }

  // 5. Income that arrived, as months of stack kept.
  sections.push({
    id: "income-arrived",
    title: "Income you brought in",
    facts: [
      {
        id: "income-arrived-amount",
        label: "Money that came in",
        value: roundToCents(input.incomeArrived.amountUsd),
        unit: "usd",
        tone: "good",
      },
      {
        id: "income-arrived-months",
        label: "Months of your stack that kept",
        value: input.incomeArrived.monthsOfStackKept,
        unit: "months",
        tone: "good",
        detail: "Earning this let you avoid spending down your savings",
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
