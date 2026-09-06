import { isNonnegativeSafeInteger } from "@/lib/wallet/types"

export const LOCKTIME_THRESHOLD = 500000000
export const SEQUENCE_FINAL = 0xffffffff
export const SEQUENCE_DISABLE_FLAG = 0x80000000
export const SEQUENCE_TIME_FLAG = 0x00400000
export const SEQUENCE_VALUE_MASK = 0x0000ffff
export const SEQUENCE_TIME_GRANULARITY = 512

export type LocktimeValue = { readonly unit: "blocks" | "seconds"; readonly value: number }

function requireUint32(value: number): void {
  if (!isNonnegativeSafeInteger(value) || value > SEQUENCE_FINAL) throw new Error("Expected an unsigned 32-bit integer")
}

export function absoluteLocktime(lock: LocktimeValue): number {
  requireUint32(lock.value)
  if (lock.unit !== "blocks" && lock.unit !== "seconds") throw new Error("Unknown locktime unit")
  if ((lock.unit === "blocks") !== (lock.value < LOCKTIME_THRESHOLD)) throw new Error("Locktime value does not match its unit")
  return lock.value
}

export function relativeSequence(lock: LocktimeValue): number {
  if (!isNonnegativeSafeInteger(lock.value)) throw new Error("Expected nonnegative integer relative units")
  if (lock.unit !== "blocks" && lock.unit !== "seconds") throw new Error("Unknown relative locktime unit")
  const divisor = lock.unit === "seconds" ? SEQUENCE_TIME_GRANULARITY : 1
  if (lock.value % divisor !== 0 || lock.value / divisor > SEQUENCE_VALUE_MASK) throw new Error("Relative locktime exceeds its range or is not an exact 512-second multiple")
  return lock.value / divisor + (lock.unit === "seconds" ? SEQUENCE_TIME_FLAG : 0)
}

export function decodeRelativeSequence(sequence: number): LocktimeValue {
  requireUint32(sequence)
  if ((sequence & ~(SEQUENCE_TIME_FLAG | SEQUENCE_VALUE_MASK)) !== 0) throw new Error("Disabled and reserved sequence flags are not supported")
  const timeBased = (sequence & SEQUENCE_TIME_FLAG) !== 0
  return { unit: timeBased ? "seconds" : "blocks", value: (sequence & SEQUENCE_VALUE_MASK) * (timeBased ? SEQUENCE_TIME_GRANULARITY : 1) }
}

export function checkCltv(requiredLocktime: number, transactionLocktime: number, inputSequence: number): boolean {
  requireUint32(requiredLocktime)
  requireUint32(transactionLocktime)
  requireUint32(inputSequence)
  return (requiredLocktime < LOCKTIME_THRESHOLD) === (transactionLocktime < LOCKTIME_THRESHOLD) && transactionLocktime >= requiredLocktime && inputSequence !== SEQUENCE_FINAL
}

export function checkCsv(requiredSequence: number, transactionVersion: number, inputSequence: number): boolean {
  if (!Number.isSafeInteger(transactionVersion) || transactionVersion < -0x80000000 || transactionVersion > 0x7fffffff) throw new Error("Expected a signed 32-bit transaction version")
  const required = decodeRelativeSequence(requiredSequence)
  const actual = decodeRelativeSequence(inputSequence)
  return transactionVersion >= 2 && required.unit === actual.unit && actual.value >= required.value
}

export function isAbsoluteLocktimeMature(
  locktime: number,
  context: { readonly candidateHeight: number; readonly previousMedianTimePast: number },
): boolean {
  requireUint32(locktime)
  if (!isNonnegativeSafeInteger(context.candidateHeight) || !isNonnegativeSafeInteger(context.previousMedianTimePast)) throw new Error("Expected explicit consensus height and median time past")
  if (locktime === 0) return true
  return locktime < (locktime < LOCKTIME_THRESHOLD ? context.candidateHeight : context.previousMedianTimePast)
}
