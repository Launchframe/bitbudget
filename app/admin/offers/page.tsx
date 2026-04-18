"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"

interface OfferRow {
  id: string
  code: string
  label: string | null
  maxUses: number
  usedCount: number
  visitCount: number
  startsAt: string
  expiresAt: string
  active: boolean
  referralCount: number
  expired: boolean
}

export default function AdminOffersPage() {
  const [rows, setRows] = useState<OfferRow[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [code, setCode] = useState("")
  const [label, setLabel] = useState("")
  const [maxUses, setMaxUses] = useState("500")
  const [startsAt, setStartsAt] = useState("")
  const [expiresAt, setExpiresAt] = useState("")
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    fetch("/api/admin/offers")
      .then((r) => r.json())
      .then(setRows)
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function createOffer(e: React.FormEvent) {
    e.preventDefault()
    setErr(null)
    setSaving(true)
    try {
      const res = await fetch("/api/admin/offers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code,
          label: label || null,
          maxUses: parseInt(maxUses, 10) || 100,
          startsAt: startsAt || undefined,
          expiresAt: expiresAt || undefined,
        }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        setErr(typeof j.error === "string" ? j.error : "Failed")
        return
      }
      setOpen(false)
      setCode("")
      setLabel("")
      load()
    } finally {
      setSaving(false)
    }
  }

  async function deactivate(id: string) {
    await fetch(`/api/admin/offers/${id}`, { method: "DELETE" })
    load()
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-[#E7E7E7]">Offer codes</h1>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-xl bg-[#F7931A] px-4 py-2 text-sm font-semibold text-[#0D0D0D]"
        >
          Create offer
        </button>
      </div>

      {open && (
        <form
          onSubmit={createOffer}
          className="rounded-2xl border border-[#1F1F1F] bg-[#141414] p-6 space-y-4 max-w-lg"
        >
          <h2 className="text-lg font-semibold text-[#E7E7E7]">New offer</h2>
          {err && <p className="text-sm text-red-400">{err}</p>}
          <div>
            <label className="text-xs text-[#919191]">Slug (URL path)</label>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toLowerCase())}
              className="mt-1 w-full rounded-xl border border-[#333] bg-[#0D0D0D] px-3 py-2 text-[#E7E7E7]"
              placeholder="podcast-50"
              required
            />
          </div>
          <div>
            <label className="text-xs text-[#919191]">Label</label>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className="mt-1 w-full rounded-xl border border-[#333] bg-[#0D0D0D] px-3 py-2 text-[#E7E7E7]"
            />
          </div>
          <div>
            <label className="text-xs text-[#919191]">Max uses</label>
            <input
              type="number"
              min={1}
              value={maxUses}
              onChange={(e) => setMaxUses(e.target.value)}
              className="mt-1 w-full rounded-xl border border-[#333] bg-[#0D0D0D] px-3 py-2 text-[#E7E7E7]"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-[#919191]">Start (ISO)</label>
              <input
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
                className="mt-1 w-full rounded-xl border border-[#333] bg-[#0D0D0D] px-3 py-2 text-[#E7E7E7] text-sm"
                placeholder="optional"
              />
            </div>
            <div>
              <label className="text-xs text-[#919191]">End (ISO)</label>
              <input
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
                className="mt-1 w-full rounded-xl border border-[#333] bg-[#0D0D0D] px-3 py-2 text-[#E7E7E7] text-sm"
                placeholder="optional"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={saving}
              className="rounded-xl bg-[#F7931A] px-4 py-2 text-sm font-semibold text-[#0D0D0D]"
            >
              {saving ? "Saving…" : "Create"}
            </button>
            <button type="button" onClick={() => setOpen(false)} className="text-sm text-[#919191]">
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className="overflow-hidden rounded-2xl border border-[#1F1F1F] bg-[#141414]">
        {loading ? (
          <div className="p-8 text-center text-[#919191]">Loading…</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#1F1F1F] text-left text-xs uppercase text-[#919191]">
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">Label</th>
                <th className="px-4 py-3">Visits</th>
                <th className="px-4 py-3">Used</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => (
                <tr key={o.id} className="border-b border-[#1F1F1F] text-[#CCC]">
                  <td className="px-4 py-2 font-mono">
                    <Link href={`/admin/offers/${o.id}`} className="text-[#F7931A] hover:underline">
                      {o.code}
                    </Link>
                  </td>
                  <td className="px-4 py-2">{o.label ?? "—"}</td>
                  <td className="px-4 py-2">{o.visitCount}</td>
                  <td className="px-4 py-2">
                    {o.usedCount} / {o.maxUses}
                  </td>
                  <td className="px-4 py-2">{o.active && !o.expired ? "active" : "inactive"}</td>
                  <td className="px-4 py-2">
                    <button
                      type="button"
                      onClick={() => deactivate(o.id)}
                      className="text-xs text-red-400 hover:underline"
                    >
                      Deactivate
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
