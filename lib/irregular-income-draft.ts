import { loadDraft, saveDraft } from "@/lib/draft-storage"

export const IRREGULAR_INCOME_DRAFT_KEY = "bitbudget-irregular-income-draft"

export type IrregularIncomeDraftStep = "details" | "distribute"

export interface IrregularIncomeDraftV1 {
  v: 1
  step: IrregularIncomeDraftStep
  amount: string
  date: string
  payee: string
  notes: string
  destination: "savings" | "envelopes"
}

export function isIrregularIncomeDraftV1(value: unknown): value is IrregularIncomeDraftV1 {
  if (typeof value !== "object" || value === null) return false
  const o = value as Record<string, unknown>
  if (o.v !== 1) return false
  if (o.step !== "details" && o.step !== "distribute") return false
  if (typeof o.amount !== "string") return false
  if (typeof o.date !== "string") return false
  if (typeof o.payee !== "string") return false
  if (typeof o.notes !== "string") return false
  if (o.destination !== "savings" && o.destination !== "envelopes") return false
  return true
}

export function loadIrregularIncomeDraft(): IrregularIncomeDraftV1 | null {
  return loadDraft(IRREGULAR_INCOME_DRAFT_KEY, isIrregularIncomeDraftV1)
}

export function saveIrregularIncomeDraft(draft: IrregularIncomeDraftV1): void {
  saveDraft(IRREGULAR_INCOME_DRAFT_KEY, draft, 400)
}
