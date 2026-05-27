// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  activeTransactionSetupSignature,
  discretionaryAllotmentSignature,
  focusSettingsSection,
  receiptInboxPendingSetupSignature,
} from "@/lib/setup-guide-client"
import { SETTINGS_INITIAL_TAB_STORAGE_KEY } from "@/lib/payee-mapping-dismissals"
import type { Envelope, PendingTransaction, Transaction } from "@/lib/data"

describe("setup-guide-client", () => {
  beforeEach(() => {
    sessionStorage.clear()
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(0)
      return 0
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    sessionStorage.clear()
    document.body.innerHTML = ""
  })

  it("discretionaryAllotmentSignature ignores savings and archived", () => {
    const envelopes: Envelope[] = [
      { id: "s", name: "Savings", monthlyAllotment: 100, color: "#", systemRole: "savings" },
      { id: "a", name: "Food", monthlyAllotment: 50, color: "#" },
      { id: "b", name: "Old", monthlyAllotment: 10, color: "#", archived: true },
    ]
    expect(discretionaryAllotmentSignature(envelopes)).toBe("a:50")
  })

  it("activeTransactionSetupSignature changes when setup-relevant fields change", () => {
    const base: Transaction = {
      id: "t1",
      envelopeId: "e1",
      date: "2026-05-01",
      payee: "enc",
      amount: 50,
      type: "expense",
      tags: [],
      source: "manual",
    }
    const a = activeTransactionSetupSignature([base])
    const b = activeTransactionSetupSignature([
      { ...base, type: "credit", source: "paycheck" },
    ])
    expect(a).not.toBe(b)
    expect(activeTransactionSetupSignature([base])).toBe(a)
  })

  it("receiptInboxPendingSetupSignature tracks forwarded receipt pending rows only", () => {
    const pending: PendingTransaction[] = [
      {
        id: "receipt-1",
        source: "email_forward",
        payee: "enc",
        amount: 12,
        date: "2026-05-01",
        suggestedEnvelopeId: null,
        confidence: 0.9,
        createdAt: "2026-05-01T00:00:00.000Z",
      },
      {
        id: "sms-1",
        source: "sms",
        payee: "enc",
        amount: 8,
        date: "2026-05-01",
        suggestedEnvelopeId: null,
        confidence: 0.8,
        createdAt: "2026-05-01T00:00:01.000Z",
      },
    ]

    expect(receiptInboxPendingSetupSignature(pending)).toBe(
      "receipt-1\temail_forward\t2026-05-01T00:00:00.000Z",
    )
  })

  it("focusSettingsSection opens Data & Security for linked sign-in email controls", () => {
    document.body.innerHTML = `<div id="settings-linked-sign-in"></div>`
    const target = document.getElementById("settings-linked-sign-in")!
    const scrollIntoView = vi.fn()
    target.scrollIntoView = scrollIntoView

    const events: string[] = []
    const onSettingsTab = (e: Event) => {
      events.push((e as CustomEvent<{ tab?: string }>).detail?.tab ?? "")
    }
    window.addEventListener("bitbudget-walkthrough-settings-tab", onSettingsTab)

    focusSettingsSection("data")
    window.removeEventListener("bitbudget-walkthrough-settings-tab", onSettingsTab)

    expect(sessionStorage.getItem(SETTINGS_INITIAL_TAB_STORAGE_KEY)).toBe("data")
    expect(events).toEqual(["data"])
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" })
  })
})
