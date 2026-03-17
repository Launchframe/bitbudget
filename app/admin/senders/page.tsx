"use client"

import { useEffect, useState } from "react"

interface SenderRow {
  id: string
  senderPattern: string
  displayName: string
  createdAt: string
  admin: { email: string | null; name: string | null }
}

export default function AdminSendersPage() {
  const [senders, setSenders] = useState<SenderRow[]>([])
  const [loading, setLoading] = useState(true)
  const [senderPattern, setSenderPattern] = useState("")
  const [displayName, setDisplayName] = useState("")
  const [submitting, setSubmitting] = useState(false)

  function fetchSenders() {
    fetch("/api/admin/senders")
      .then((r) => r.json())
      .then(setSenders)
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    fetchSenders()
  }, [])

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!senderPattern.trim() || !displayName.trim()) return
    setSubmitting(true)
    try {
      const res = await fetch("/api/admin/senders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ senderPattern: senderPattern.trim(), displayName: displayName.trim() }),
      })
      if (!res.ok) throw new Error(await res.text())
      setSenderPattern("")
      setDisplayName("")
      fetchSenders()
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm("Delete this sender?")) return
    const res = await fetch(`/api/admin/senders?id=${encodeURIComponent(id)}`, { method: "DELETE" })
    if (!res.ok) throw new Error(await res.text())
    fetchSenders()
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-[#E7E7E7]">Approved Receipt Senders</h1>

      <form
        onSubmit={handleAdd}
        className="flex flex-wrap items-end gap-4 rounded-2xl border border-[#1F1F1F] bg-[#141414] p-4"
      >
        <div>
          <label className="mb-1 block text-xs font-medium text-[#919191]">Sender Pattern</label>
          <input
            type="text"
            value={senderPattern}
            onChange={(e) => setSenderPattern(e.target.value)}
            placeholder="e.g. noreply@example.com"
            className="w-64 rounded-xl border border-[#333] bg-[#0D0D0D] px-4 py-2.5 text-[#E7E7E7] placeholder:text-[#666] focus:border-[#F7931A] focus:outline-none focus:ring-1 focus:ring-[#F7931A]"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-[#919191]">Display Name</label>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="e.g. Example Store"
            className="w-64 rounded-xl border border-[#333] bg-[#0D0D0D] px-4 py-2.5 text-[#E7E7E7] placeholder:text-[#666] focus:border-[#F7931A] focus:outline-none focus:ring-1 focus:ring-[#F7931A]"
          />
        </div>
        <button
          type="submit"
          disabled={submitting || !senderPattern.trim() || !displayName.trim()}
          className="rounded-xl bg-[#F7931A] px-4 py-2.5 font-medium text-black hover:bg-[#F7931A]/90 disabled:opacity-50"
        >
          Add
        </button>
      </form>

      <div className="overflow-hidden rounded-2xl border border-[#1F1F1F] bg-[#141414]">
        {loading ? (
          <div className="p-8 text-center text-[#919191]">Loading...</div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#1F1F1F]">
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-[#919191]">Sender Pattern</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-[#919191]">Display Name</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-[#919191]">Added By</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-[#919191]">Date</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-[#919191]"></th>
              </tr>
            </thead>
            <tbody>
              {senders.map((s) => (
                <tr key={s.id} className="border-b border-[#1F1F1F] last:border-0">
                  <td className="px-4 py-3 text-[#E7E7E7]">{s.senderPattern}</td>
                  <td className="px-4 py-3 text-[#E7E7E7]">{s.displayName}</td>
                  <td className="px-4 py-3 text-[#E7E7E7]">
                    {s.admin?.name || s.admin?.email || "—"}
                  </td>
                  <td className="px-4 py-3 text-[#919191]">
                    {new Date(s.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => handleDelete(s.id)}
                      className="text-sm text-red-400 hover:text-red-300"
                    >
                      Delete
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
