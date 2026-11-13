"use client"

import { useEffect, useMemo, useState } from "react"
import { useApp } from "@/lib/app-context"
import {
  budgetEnvelopeUnavailable,
  budgetPayeeReady,
  budgetPostingSkipped,
  missingAdvanceEventIdsFromPostings,
  projectMemberBudget,
  shoppingEntryLabel,
  shoppingEntryPayee,
  type ShoppingPreferenceSnapshot,
} from "@/lib/shopping-budget-projection"
import { centsToUsdLabel } from "@/lib/shopping-payloads"
import type { ShoppingProjectedEntry } from "@/lib/shopping-types"
import type { DecryptedGroupView } from "@/lib/shopping-view"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"

const SETTLED = new Set(["posted", "skipped", "suppressed"])

type BudgetPostingRow = { eventId: string; entryKey: string; status: string }

export function ShoppingBudgetCard({
  view,
  fetchPreference,
  listPostings,
  savePreference,
  applyPostings,
}: {
  view: DecryptedGroupView
  fetchPreference: (groupId: string) => Promise<ShoppingPreferenceSnapshot>
  listPostings: (groupId: string) => Promise<BudgetPostingRow[]>
  savePreference: (groupId: string, body: Record<string, unknown>) => Promise<unknown>
  applyPostings: (groupId: string, body: Record<string, unknown>) => Promise<Record<string, unknown>>
}) {
  const { discretionaryEnvelopes, encryptForStorage, refreshData } = useApp()
  const [pref, setPref] = useState<ShoppingPreferenceSnapshot | null>(null)
  const [envelopeId, setEnvelopeId] = useState("")
  const [catchUp, setCatchUp] = useState(false)
  const [settled, setSettled] = useState<Set<string>>(new Set())
  const [postingRows, setPostingRows] = useState<BudgetPostingRow[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const [nextPref, rows] = await Promise.all([
          fetchPreference(view.groupId),
          listPostings(view.groupId),
        ])
        if (cancelled) return
        setPref(nextPref)
        setEnvelopeId(nextPref.envelopeId ?? "")
        setCatchUp(nextPref.catchUpApproved)
        setPostingRows(rows)
        setSettled(
          new Set(rows.filter((row) => SETTLED.has(row.status)).map((row) => row.entryKey)),
        )
        setError(null)
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not load budget settings")
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [fetchPreference, listPostings, view.groupId])

  const projected = useMemo(() => {
    if (!pref?.enabled) return []
    return projectMemberBudget({
      events: view.events,
      context: {
        memberId: view.me.id,
        preference: pref,
        missingAdvanceEventIds: missingAdvanceEventIdsFromPostings(postingRows),
      },
    })
  }, [postingRows, pref, view.events, view.me.id])

  const pending = projected.filter((row) => !settled.has(row.entryKey))
  const preferenceDraftDirty =
    pref != null &&
    (envelopeId !== (pref.envelopeId ?? "") || catchUp !== pref.catchUpApproved)
  const selectedEnvelope =
    discretionaryEnvelopes.find((env) => env.id === (pref?.envelopeId ?? "")) ?? null

  async function reload() {
    const [nextPref, rows] = await Promise.all([
      fetchPreference(view.groupId),
      listPostings(view.groupId),
    ])
    setPref(nextPref)
    setEnvelopeId(nextPref.envelopeId ?? "")
    setCatchUp(nextPref.catchUpApproved)
    setPostingRows(rows)
    setSettled(new Set(rows.filter((row) => SETTLED.has(row.status)).map((row) => row.entryKey)))
  }

  async function save(enabled: boolean) {
    if (!pref) return
    const chosen = envelopeId
    if (enabled && !chosen) {
      setError(
        discretionaryEnvelopes.length === 0
          ? "Create an envelope first, then turn this on."
          : "Choose an envelope first.",
      )
      return
    }
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await savePreference(view.groupId, {
        expectedVersion: pref.preferenceVersion,
        enabled,
        envelopeId: enabled ? chosen || null : pref.envelopeId,
        catchUpApproved: enabled ? catchUp : false,
      })
      await reload()
      setNotice(enabled ? "New shared purchases can be added to your budget." : "Your budget is left alone.")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save")
    } finally {
      setBusy(false)
    }
  }

  async function addRow(row: ShoppingProjectedEntry) {
    if (row.needsAttention) return
    if (!pref?.envelopeId) {
      setError("Choose an envelope first.")
      return
    }
    setBusy(true)
    setError(null)
    try {
      const payload = view.events.find((item) => item.id === row.sourceEventId)?.payload
      const receiptId = payload?.type === "receipt_finalized" ? payload.receiptId : undefined
      const merchant = receiptId
        ? view.receipts.find((receipt) => receipt.id === receiptId)?.merchant
        : undefined
      const payee = await encryptForStorage(shoppingEntryPayee({ eventType: payload?.type, merchant }))
      if (!budgetPayeeReady(payee)) {
        setError("Unlock BitBudget, then try adding this again.")
        return
      }
      const result = await applyPostings(view.groupId, {
        eventId: row.sourceEventId,
        preferenceVersion: pref.preferenceVersion,
        projectionRevision: pref.preferenceVersion,
        entries: [
          {
            entryKey: row.entryKey,
            kind: row.kind,
            cents: row.cents,
            type: row.type,
            postedOn: row.postedOn,
            payee,
            envelopeId: pref.envelopeId,
          },
        ],
      })
      if (budgetEnvelopeUnavailable(result)) {
        setError("That envelope is no longer available. Choose another one and save.")
        await reload()
        return
      }
      if (budgetPostingSkipped(result)) {
        setError("This was already skipped.")
        await reload()
        return
      }
      await refreshData()
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add this to your budget")
    } finally {
      setBusy(false)
    }
  }

  async function skipRow(row: ShoppingProjectedEntry) {
    if (!pref) return
    setBusy(true)
    setError(null)
    try {
      await applyPostings(view.groupId, {
        action: "skip",
        eventId: row.sourceEventId,
        entryKey: row.entryKey,
        preferenceVersion: pref.preferenceVersion,
      })
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not skip this")
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="flex min-w-0 flex-col gap-4 rounded-2xl border border-border/70 bg-card p-4 sm:p-6">
      <div className="min-w-0">
        <h2 className="text-base font-semibold">Your budget</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          This only adds rows to your own budget. Other people in the group cannot see your envelopes.
        </p>
      </div>

      {!pref && !error && <p className="text-sm text-muted-foreground">Loading…</p>}

      {pref && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-3">
            <label htmlFor="shopping-budget-enabled" className="text-sm">
              Add shared purchases to an envelope
            </label>
            <Switch
              id="shopping-budget-enabled"
              checked={pref.enabled}
              disabled={busy}
              onCheckedChange={(next) => void save(next)}
            />
          </div>

          <label className="flex min-w-0 flex-col gap-1.5 text-sm">
            Envelope
            <select
              className="h-10 w-full min-w-0 rounded-xl border border-border bg-background px-3"
              value={envelopeId}
              disabled={busy || discretionaryEnvelopes.length === 0}
              onChange={(event) => setEnvelopeId(event.target.value)}
            >
              <option value="">Choose an envelope</option>
              {discretionaryEnvelopes.map((env) => (
                <option key={env.id} value={env.id}>
                  {env.name}
                </option>
              ))}
            </select>
          </label>

          <div className="flex items-center justify-between gap-3">
            <label htmlFor="shopping-budget-catchup" className="text-sm">
              Include purchases already on the tab
            </label>
            <Switch
              id="shopping-budget-catchup"
              checked={catchUp}
              disabled={busy}
              onCheckedChange={setCatchUp}
            />
          </div>

          {pref.enabled && preferenceDraftDirty && (
            <Button type="button" className="w-full sm:w-auto" disabled={busy} onClick={() => void save(true)}>
              Save
            </Button>
          )}

          {pref.enabled && selectedEnvelope && (
            <p className="text-sm text-muted-foreground">
              Going into {selectedEnvelope.name}.
            </p>
          )}

          {pref.enabled && pending.length === 0 && (
            <p className="text-sm text-muted-foreground">Nothing new to add.</p>
          )}

          {pref.enabled && preferenceDraftDirty && pending.length > 0 && (
            <p className="text-sm text-muted-foreground">Save your choices before adding rows.</p>
          )}

          {pref.enabled && pending.length > 0 && (
            <ul className="flex flex-col gap-3">
              {pending.map((row) => (
                <li
                  key={row.entryKey}
                  className="flex min-w-0 flex-col gap-3 rounded-xl bg-secondary/50 px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{shoppingEntryLabel(row.kind)}</p>
                    <p className="text-sm text-muted-foreground">
                      {centsToUsdLabel(row.cents)} · {row.postedOn}
                    </p>
                    {row.needsAttention && (
                      <p className="text-sm text-muted-foreground">
                        You skipped the earlier amount, so this payback stays off your budget.
                      </p>
                    )}
                  </div>
                  <div className="flex gap-2">
                    {!row.needsAttention && (
                      <Button
                        type="button"
                        size="sm"
                        disabled={busy || preferenceDraftDirty}
                        onClick={() => void addRow(row)}
                      >
                        Add
                      </Button>
                    )}
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={busy || preferenceDraftDirty}
                      onClick={() => void skipRow(row)}
                    >
                      Skip
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {notice && <p className="text-sm text-muted-foreground">{notice}</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </section>
  )
}
