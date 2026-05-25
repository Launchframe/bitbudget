import {
  SWEEP_POLICY_CAPPED,
  SWEEP_POLICY_CARRY_FORWARD,
  SWEEP_POLICY_RESET,
} from "@/lib/constants"
import { formatUsd } from "@/lib/data"
import { sweepAmountForEnvelope } from "@/lib/envelope-sweep"

export type SweepPolicy =
  | typeof SWEEP_POLICY_RESET
  | typeof SWEEP_POLICY_CARRY_FORWARD
  | typeof SWEEP_POLICY_CAPPED

export type SweepExampleEnvelope = {
  id: string
  name: string
  balance: number
  monthlyAllotment: number
}

export type SweepPolicyHint = {
  description: string
  example: string | null
}

export const SWEEP_POLICY_DESCRIPTIONS: Record<SweepPolicy, string> = {
  [SWEEP_POLICY_RESET]:
    "Start each cycle with no more than your allocated amount. Only surplus above that allotment sweeps to Savings. If the envelope is below its allocation but still has money left, nothing sweeps.",
  [SWEEP_POLICY_CARRY_FORWARD]:
    "On each payday, leftover money stays in the envelope. Nothing moves to Savings until you spend it or sweep manually.",
  [SWEEP_POLICY_CAPPED]:
    "On each payday, you keep up to a cap in each envelope. Only surplus above that cap sweeps to Savings.",
}

/** Pick an envelope with positive month balance, else the largest monthly allotment. */
export function pickSweepExampleEnvelope(
  envelopes: ReadonlyArray<{ id: string; name: string; monthlyAllotment: number }>,
  getBalance: (envelopeId: string) => number,
): SweepExampleEnvelope | null {
  if (envelopes.length === 0) return null

  let bestPositive: SweepExampleEnvelope | null = null
  let bestAllotment: SweepExampleEnvelope | null = null

  for (const env of envelopes) {
    const balance = getBalance(env.id)
    const row: SweepExampleEnvelope = {
      id: env.id,
      name: env.name,
      balance,
      monthlyAllotment: env.monthlyAllotment,
    }
    if (balance > 0 && (!bestPositive || balance > bestPositive.balance)) {
      bestPositive = row
    }
    if (
      env.monthlyAllotment > 0 &&
      (!bestAllotment || env.monthlyAllotment > bestAllotment.monthlyAllotment)
    ) {
      bestAllotment = row
    }
  }

  return bestPositive ?? bestAllotment
}

function exampleForAllotmentCap(
  env: SweepExampleEnvelope,
  capMultiplier: number,
  policy: typeof SWEEP_POLICY_RESET | typeof SWEEP_POLICY_CAPPED,
): string | null {
  if (env.monthlyAllotment <= 0) {
    return `${env.name} has no monthly budget set. This policy needs a budget amount to know how much can stay in the envelope.`
  }

  const cap = Math.round(capMultiplier * env.monthlyAllotment * 100) / 100
  const capLabel =
    policy === SWEEP_POLICY_RESET
      ? `its ${formatUsd(env.monthlyAllotment)} allocation`
      : `a ${capMultiplier}× cap (${formatUsd(cap)}) on its ${formatUsd(env.monthlyAllotment)} budget`

  const sampleBalance = env.balance > cap ? env.balance : Math.round(cap * 1.25 * 100) / 100
  const sampleSweep = sweepAmountForEnvelope({
    balance: sampleBalance,
    policy,
    monthlyAllotment: env.monthlyAllotment,
    capMultiplier: policy === SWEEP_POLICY_RESET ? 1 : capMultiplier,
  })
  const sampleKeep = Math.round((sampleBalance - sampleSweep) * 100) / 100

  if (env.balance > cap) {
    const actualSweep = sweepAmountForEnvelope({
      balance: env.balance,
      policy,
      monthlyAllotment: env.monthlyAllotment,
      capMultiplier: policy === SWEEP_POLICY_RESET ? 1 : capMultiplier,
    })
    const actualKeep = Math.round((env.balance - actualSweep) * 100) / 100
    return `${env.name} has ${formatUsd(env.balance)} left with ${capLabel}. On payday, ${formatUsd(actualSweep)} sweeps to Savings and ${formatUsd(actualKeep)} stays in ${env.name}.`
  }

  if (env.balance > 0) {
    return `${env.name} has ${formatUsd(env.balance)} left — under ${capLabel}. On payday, nothing sweeps. After your next refill, you start the cycle at that balance plus your new allocation.`
  }

  return `${env.name} has no leftover this month. With ${capLabel}, up to ${formatUsd(cap)} can roll over; surplus above that sweeps to Savings.`
}

function exampleForCarryForward(env: SweepExampleEnvelope): string | null {
  if (env.balance <= 0) {
    return `${env.name} has no leftover this month. When it does at payday, that balance stays put for next period — nothing moves to Savings.`
  }
  return `${env.name} has ${formatUsd(env.balance)} left this month. On payday, nothing moves — you keep ${formatUsd(env.balance)} to spend next period.`
}

export function buildSweepPolicyHint(params: {
  policy: SweepPolicy
  capMultiplier: number
  example: SweepExampleEnvelope | null
}): SweepPolicyHint {
  const description = SWEEP_POLICY_DESCRIPTIONS[params.policy]
  if (!params.example) {
    return { description, example: null }
  }

  let example: string | null = null
  switch (params.policy) {
    case SWEEP_POLICY_RESET:
      example = exampleForAllotmentCap(params.example, 1, SWEEP_POLICY_RESET)
      break
    case SWEEP_POLICY_CARRY_FORWARD:
      example = exampleForCarryForward(params.example)
      break
    case SWEEP_POLICY_CAPPED:
      example = exampleForAllotmentCap(params.example, params.capMultiplier, SWEEP_POLICY_CAPPED)
      break
    default: {
      const _exhaustive: never = params.policy
      return _exhaustive
    }
  }

  return { description, example }
}
