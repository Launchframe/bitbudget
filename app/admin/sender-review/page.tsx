"use client"

import { useEffect, useState } from "react"

interface PendingSender {
  id: string
  senderAddress: string
  samplePayee: string | null
  sampleAmount: number | null
  occurrenceCount: number
  firstSeenAt: string
  lastSeenAt: string
}

export default function AdminSenderReviewPage() {
  const [items, setItems] = useState<PendingSender[]>([])
  const [loading, setLoading] = useState(true)
  const [approvingId, setApprovingId] = useState<string | null>(null)
  const [displayName, setDisplayName] = useState("")

  function fetchItems() {
    fetch("/api/admin/sender-review")
      .then((r) => r.json())
      .then(setItems)
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    fetchItems()
  }, [])

  async function handleApprove(id: string) {
    if (!displayName.trim()) return
    const res = await fetch("/api/admin/sender-review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, action: "approve", displayName: displayName.trim() }),
    })
    if (!res.ok) throw new Error(await res.text())
    setApprovingId(null)
    setDisplayName("")
    fetchItems()
  }

  async function handleDismiss(id: string) {
    if (!window.confirm("Dismiss this sender from the review queue?")) return
    const res = await fetch("/api/admin/sender-review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, action: "dismiss" }),
    })
    if (!res.ok) throw new Error(await res.text())
    fetchItems()
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-[#E7E7E7]">Sender Review Queue</h1>
        <div className="p-8 text-center text-[#919191]">Loading...</div>
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-[#E7E7E7]">Sender Review Queue</h1>
        <div className="rounded-2xl border border-[#1F1F1F] bg-[#141414] p-12 text-center text-[#919191]">
          No senders pending review.
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-[#E7E7E7]">Sender Review Queue</h1>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => (
          <div
            key={item.id}
            className="rounded-2xl border border-[#1F1F1F] bg-[#141414] p-4"
          >
            <div className="mb-3 font-mono text-sm text-[#F7931A]">{item.senderAddress}</div>
            <div className="mb-2 text-sm text-[#E7E7E7]">
              Sample: {item.samplePayee ?? "—"}
              {item.sampleAmount != null && ` · ${item.sampleAmount}`}
            </div>
            <div className="mb-3 text-xs text-[#919191]">
              {item.occurrenceCount} occurrence{item.occurrenceCount !== 1 ? "s" : ""} · First:{" "}
              {new Date(item.firstSeenAt).toLocaleDateString()} · Last:{" "}
              {new Date(item.lastSeenAt).toLocaleDateString()}
            </div>

            {approvingId === item.id ? (
              <div className="flex flex-col gap-2">
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Display name"
                  className="rounded-xl border border-[#333] bg-[#0D0D0D] px-3 py-2 text-sm text-[#E7E7E7] placeholder:text-[#666] focus:border-[#F7931A] focus:outline-none"
                  autoFocus
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => handleApprove(item.id)}
                    disabled={!displayName.trim()}
                    className="rounded-lg bg-[#F7931A] px-3 py-1.5 text-sm font-medium text-black hover:bg-[#F7931A]/90 disabled:opacity-50"
                  >
                    Confirm
                  </button>
                  <button
                    type="button"
                    onClick={() => { setApprovingId(null); setDisplayName("") }}
                    className="rounded-lg border border-[#333] px-3 py-1.5 text-sm text-[#E7E7E7] hover:bg-[#1A1A1A]"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setApprovingId(item.id)}
                  className="rounded-lg bg-[#F7931A] px-3 py-1.5 text-sm font-medium text-black hover:bg-[#F7931A]/90"
                >
                  Approve
                </button>
                <button
                  type="button"
                  onClick={() => handleDismiss(item.id)}
                  className="rounded-lg border border-[#333] px-3 py-1.5 text-sm text-[#E7E7E7] hover:bg-[#1A1A1A]"
                >
                  Dismiss
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
