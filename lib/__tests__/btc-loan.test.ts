import { describe, expect, it } from "vitest"
import {
  MAX_APR_FRACTION,
  MAX_LOAN_LABEL_LENGTH,
  parseLoanCreateBody,
  parseLoanSummaryQuery,
  parseLoanUpdateBody,
  resolveLoanDateUpdate,
  serializeLoanEvaluation,
  toLoanHealthInput,
  validateAprFraction,
  validateCalendarDate,
  validateSats,
} from "@/lib/btc-loan"
import { evaluateLoan, type LoanEvaluation } from "@/lib/loan-health"

function validCreateBody(overrides: Record<string, unknown> = {}) {
  return {
    label: "Unchained 12mo",
    principalUsd: 50000,
    apr: 0.1,
    openedOn: "2026-01-01",
    maturityOn: "2027-01-01",
    collateralSats: 100_000_000,
    lenderSellPriceUsd: 40000,
    payoffStyle: "accrued",
    ...overrides,
  }
}

describe("validateCalendarDate", () => {
  it("accepts a valid YYYY-MM-DD date", () => {
    expect(validateCalendarDate("2026-02-28", "Open date")).toEqual({
      ok: true,
      value: "2026-02-28",
    })
  })

  it("trims surrounding whitespace", () => {
    const r = validateCalendarDate("  2026-03-15  ", "Open date")
    expect(r).toEqual({ ok: true, value: "2026-03-15" })
  })

  it("rejects the wrong format", () => {
    const r = validateCalendarDate("03/15/2026", "Open date")
    expect(r.ok).toBe(false)
  })

  it("rejects impossible calendar dates that would roll over", () => {
    const r = validateCalendarDate("2026-02-30", "Maturity date")
    expect(r.ok).toBe(false)
  })

  it("rejects non-string input", () => {
    expect(validateCalendarDate(20260101, "Open date").ok).toBe(false)
  })
})

describe("validateAprFraction", () => {
  it("accepts a fraction and rounds to 4 decimals", () => {
    expect(validateAprFraction(0.10004)).toEqual({ ok: true, value: 0.1 })
    expect(validateAprFraction(0.10005)).toEqual({ ok: true, value: 0.1001 })
  })

  it("accepts a numeric string", () => {
    expect(validateAprFraction("0.075")).toEqual({ ok: true, value: 0.075 })
  })

  it("rejects negatives", () => {
    expect(validateAprFraction(-0.1).ok).toBe(false)
  })

  it("rejects values above the max fraction (likely a percent)", () => {
    const r = validateAprFraction(MAX_APR_FRACTION + 1)
    expect(r.ok).toBe(false)
  })

  it("rejects empty/invalid input", () => {
    expect(validateAprFraction("").ok).toBe(false)
    expect(validateAprFraction(null).ok).toBe(false)
    expect(validateAprFraction(Number.NaN).ok).toBe(false)
  })
})

describe("validateSats", () => {
  it("accepts a non-negative integer", () => {
    expect(validateSats(100_000_000, "Collateral")).toEqual({
      ok: true,
      value: 100_000_000,
    })
  })

  it("accepts zero", () => {
    expect(validateSats(0, "Collateral")).toEqual({ ok: true, value: 0 })
  })

  it("accepts a bigint", () => {
    expect(validateSats(BigInt(123), "Collateral")).toEqual({ ok: true, value: 123 })
  })

  it("rejects fractional sats", () => {
    expect(validateSats(1.5, "Collateral").ok).toBe(false)
  })

  it("rejects negatives", () => {
    expect(validateSats(-1, "Collateral").ok).toBe(false)
  })
})

describe("parseLoanCreateBody", () => {
  it("parses and normalizes a full valid body", () => {
    const r = parseLoanCreateBody(validCreateBody())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value).toEqual({
      label: "Unchained 12mo",
      principalUsd: 50000,
      aprFraction: 0.1,
      openedOn: "2026-01-01",
      maturityOn: "2027-01-01",
      collateralSats: 100_000_000,
      lenderSellPriceUsd: 40000,
      payoffStyle: "accrued",
      maturityBillOverrideUsd: null,
      status: "open",
    })
  })

  it("defaults status to open and override to null", () => {
    const r = parseLoanCreateBody(validCreateBody())
    expect(r.ok && r.value.status).toBe("open")
    expect(r.ok && r.value.maturityBillOverrideUsd).toBe(null)
  })

  it("accepts an explicit status and maturity override", () => {
    const r = parseLoanCreateBody(
      validCreateBody({ status: "rolled", maturityBillOverrideUsd: 55000 }),
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.status).toBe("rolled")
    expect(r.value.maturityBillOverrideUsd).toBe(55000)
  })

  it("trims the label", () => {
    const r = parseLoanCreateBody(validCreateBody({ label: "  My Loan  " }))
    expect(r.ok && r.value.label).toBe("My Loan")
  })

  it("rejects an empty label", () => {
    const r = parseLoanCreateBody(validCreateBody({ label: "   " }))
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toMatch(/name is required/i)
  })

  it("rejects an over-long label", () => {
    const r = parseLoanCreateBody(validCreateBody({ label: "x".repeat(MAX_LOAN_LABEL_LENGTH + 1) }))
    expect(r.ok).toBe(false)
  })

  it("rejects a zero or negative principal", () => {
    expect(parseLoanCreateBody(validCreateBody({ principalUsd: 0 })).ok).toBe(false)
    expect(parseLoanCreateBody(validCreateBody({ principalUsd: -5 })).ok).toBe(false)
  })

  it("rejects maturity before open date", () => {
    const r = parseLoanCreateBody(
      validCreateBody({ openedOn: "2027-01-01", maturityOn: "2026-01-01" }),
    )
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toMatch(/on or after the open date/i)
  })

  it("allows maturity equal to the open date", () => {
    const r = parseLoanCreateBody(
      validCreateBody({ openedOn: "2026-01-01", maturityOn: "2026-01-01" }),
    )
    expect(r.ok).toBe(true)
  })

  it("rejects an invalid payoff style", () => {
    const r = parseLoanCreateBody(validCreateBody({ payoffStyle: "monthly" }))
    expect(r.ok).toBe(false)
  })

  it("rejects an invalid status", () => {
    const r = parseLoanCreateBody(validCreateBody({ status: "frozen" }))
    expect(r.ok).toBe(false)
  })

  it("rejects non-object bodies", () => {
    expect(parseLoanCreateBody(null).ok).toBe(false)
    expect(parseLoanCreateBody([]).ok).toBe(false)
    expect(parseLoanCreateBody("nope").ok).toBe(false)
  })

  it("rejects negative collateral sats", () => {
    expect(parseLoanCreateBody(validCreateBody({ collateralSats: -1 })).ok).toBe(false)
  })
})

describe("parseLoanUpdateBody", () => {
  it("returns only the provided fields", () => {
    const r = parseLoanUpdateBody({ label: "Renamed", status: "paid" })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value).toEqual({ label: "Renamed", status: "paid" })
  })

  it("maps apr to aprFraction", () => {
    const r = parseLoanUpdateBody({ apr: 0.2 })
    expect(r.ok && r.value.aprFraction).toBe(0.2)
  })

  it("allows clearing the maturity override with null", () => {
    const r = parseLoanUpdateBody({ maturityBillOverrideUsd: null })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect("maturityBillOverrideUsd" in r.value).toBe(true)
    expect(r.value.maturityBillOverrideUsd).toBe(null)
  })

  it("validates a provided maturity override", () => {
    expect(parseLoanUpdateBody({ maturityBillOverrideUsd: -1 }).ok).toBe(false)
    expect(parseLoanUpdateBody({ maturityBillOverrideUsd: 60000 }).ok).toBe(true)
  })

  it("ignores the id field (not an updatable column)", () => {
    const r = parseLoanUpdateBody({ id: "abc", label: "New" })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value).toEqual({ label: "New" })
  })

  it("rejects an empty patch", () => {
    const r = parseLoanUpdateBody({})
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toMatch(/no updatable fields/i)
  })

  it("rejects an id-only patch as having no updatable fields", () => {
    expect(parseLoanUpdateBody({ id: "abc" }).ok).toBe(false)
  })

  it("enforces date ordering only when both dates are present", () => {
    expect(parseLoanUpdateBody({ openedOn: "2027-01-01" }).ok).toBe(true)
    expect(parseLoanUpdateBody({ maturityOn: "2026-01-01" }).ok).toBe(true)
    const r = parseLoanUpdateBody({ openedOn: "2027-01-01", maturityOn: "2026-01-01" })
    expect(r.ok).toBe(false)
  })

  it("rejects an invalid individual field", () => {
    expect(parseLoanUpdateBody({ payoffStyle: "weekly" }).ok).toBe(false)
    expect(parseLoanUpdateBody({ status: "nope" }).ok).toBe(false)
    expect(parseLoanUpdateBody({ principalUsd: 0 }).ok).toBe(false)
  })
})

describe("resolveLoanDateUpdate", () => {
  const existing = { openedOn: "2026-01-01", maturityOn: "2026-12-01" }

  it("returns null when neither date is in the patch", () => {
    const r = resolveLoanDateUpdate(existing, {})
    expect(r).toEqual({ ok: true, value: null })
  })

  it("returns both dates when only the open date changes", () => {
    const r = resolveLoanDateUpdate(existing, { openedOn: "2026-06-01" })
    expect(r).toEqual({
      ok: true,
      value: { openedOn: "2026-06-01", maturityOn: "2026-12-01" },
    })
  })

  it("rejects a maturity date before the stored open date", () => {
    const r = resolveLoanDateUpdate(existing, { maturityOn: "2025-06-01" })
    expect(r.ok).toBe(false)
  })

  it("accepts a pair that stays ordered", () => {
    const r = resolveLoanDateUpdate(existing, {
      openedOn: "2026-03-01",
      maturityOn: "2026-03-01",
    })
    expect(r.ok).toBe(true)
  })
})

describe("parseLoanSummaryQuery", () => {
  function params(query: string) {
    return new URLSearchParams(query)
  }

  it("skips the summary when btcPriceUsd is omitted", () => {
    const r = parseLoanSummaryQuery(params("asOf=2026-02-31"), "2026-06-01")
    expect(r).toEqual({ ok: true, value: { summarize: false } })
  })

  it("rejects an impossible asOf before any other work", () => {
    const r = parseLoanSummaryQuery(params("btcPriceUsd=100000&asOf=2026-02-31"), "2026-06-01")
    expect(r.ok).toBe(false)
  })

  it("rejects a negative price and a cap outside (0, 1]", () => {
    expect(parseLoanSummaryQuery(params("btcPriceUsd=-1"), "2026-06-01").ok).toBe(false)
    expect(parseLoanSummaryQuery(params("btcPriceUsd=1&borrowCapFraction=0"), "2026-06-01").ok).toBe(
      false,
    )
    expect(parseLoanSummaryQuery(params("btcPriceUsd=1&borrowCapFraction=1.1"), "2026-06-01").ok).toBe(
      false,
    )
  })

  it("accepts a zero price and defaults asOf to the supplied today", () => {
    const r = parseLoanSummaryQuery(params("btcPriceUsd=0"), "2026-06-01")
    expect(r).toEqual({
      ok: true,
      value: {
        summarize: true,
        btcPriceUsd: 0,
        asOfDate: "2026-06-01",
        borrowCapFraction: 0.5,
      },
    })
  })
})

describe("toLoanHealthInput", () => {
  it("maps a stored loan row to the loan-health BtcLoanInput shape", () => {
    const input = toLoanHealthInput({
      id: "loan_1",
      principalUsd: 50000,
      apr: 0.1,
      openedOn: "2026-01-01",
      maturityOn: "2027-01-01",
      collateralSats: 100_000_000,
      lenderSellPriceUsd: 40000,
      payoffStyle: "full_bill",
    })
    expect(input).toEqual({
      id: "loan_1",
      principalUsd: 50000,
      aprFraction: 0.1,
      openDate: "2026-01-01",
      maturityDate: "2027-01-01",
      payoffStyle: "full_bill",
      collateralSats: 100_000_000,
      liquidationPriceUsd: 40000,
      maturityBillOverrideUsd: null,
    })
  })

  it("passes a stored maturity bill override through to loan-health", () => {
    const input = toLoanHealthInput({
      id: "loan_2",
      principalUsd: 50000,
      apr: 0.1,
      openedOn: "2026-01-01",
      maturityOn: "2027-01-01",
      collateralSats: 100_000_000,
      lenderSellPriceUsd: 40000,
      payoffStyle: "full_bill",
      maturityBillOverrideUsd: 58000,
    })
    expect(input.maturityBillOverrideUsd).toBe(58000)
  })

  it("maps a missing override to null", () => {
    const input = toLoanHealthInput({
      id: "loan_3",
      principalUsd: 50000,
      apr: 0.1,
      openedOn: "2026-01-01",
      maturityOn: "2027-01-01",
      collateralSats: 100_000_000,
      lenderSellPriceUsd: 40000,
      payoffStyle: "accrued",
      maturityBillOverrideUsd: null,
    })
    expect(input.maturityBillOverrideUsd).toBe(null)
  })
})

describe("serializeLoanEvaluation", () => {
  const baseEvaluation: LoanEvaluation = {
    id: "loan_1",
    billAtMaturityUsd: 55000,
    maturityInterestUsd: 5000,
    amountDueTodayUsd: 52500,
    collateralSats: 100_000_000,
    liquidationPriceUsd: 40000,
    liquidationRoom: { absoluteUsd: 20000, percent: 0.3333 },
    rolloverPriceUsd: 105000,
    rolloverCoversBillAtToday: true,
  }

  it("passes a finite rollover price through and marks it known", () => {
    const out = serializeLoanEvaluation(baseEvaluation)
    expect(out.rolloverPriceUsd).toBe(105000)
    expect(out.rolloverPriceKnown).toBe(true)
    // Round-trips cleanly through JSON (no Infinity → null coercion).
    expect(JSON.parse(JSON.stringify(out)).rolloverPriceUsd).toBe(105000)
  })

  it("maps an infinite rollover price to null + rolloverPriceKnown:false", () => {
    const out = serializeLoanEvaluation({
      ...baseEvaluation,
      rolloverPriceUsd: Number.POSITIVE_INFINITY,
    })
    expect(out.rolloverPriceUsd).toBe(null)
    expect(out.rolloverPriceKnown).toBe(false)
    // Other fields are preserved.
    expect(out.rolloverCoversBillAtToday).toBe(true)
    expect(out.amountDueTodayUsd).toBe(52500)
  })

  it("serializes an Infinity rollover from a real zero-collateral loan evaluation", () => {
    const evaluation = evaluateLoan(
      {
        id: "loan_no_collateral",
        principalUsd: 50000,
        aprFraction: 0.1,
        openDate: "2026-01-01",
        maturityDate: "2027-01-01",
        payoffStyle: "accrued",
        collateralSats: 0,
        liquidationPriceUsd: 40000,
      },
      { btcPriceUsd: 100000, asOfDate: "2026-07-01", borrowCapFraction: 0.5 },
    )
    // Pure math keeps Infinity as its sentinel...
    expect(evaluation.rolloverPriceUsd).toBe(Number.POSITIVE_INFINITY)
    // ...and the serializer turns it into a client-safe null + flag.
    const out = serializeLoanEvaluation(evaluation)
    expect(out.rolloverPriceUsd).toBe(null)
    expect(out.rolloverPriceKnown).toBe(false)
  })
})
