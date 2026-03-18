"use client"

import { useEffect, useState } from "react"

interface UserRow {
  id: string
  email: string | null
  name: string | null
  role: string | null
  subscriptionTier: string | null
  createdAt: string
  transactionCount: number
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<UserRow[]>([])
  const [search, setSearch] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [loading, setLoading] = useState(true)
  const [updatingId, setUpdatingId] = useState<string | null>(null)

  async function setTier(userId: string, subscriptionTier: "free" | "premium") {
    setUpdatingId(userId)
    try {
      const res = await fetch(`/api/admin/users/${userId}/tier`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscriptionTier }),
      })
      if (res.ok) {
        setUsers((prev) =>
          prev.map((u) => (u.id === userId ? { ...u, subscriptionTier } : u)),
        )
      }
    } finally {
      setUpdatingId(null)
    }
  }

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(t)
  }, [search])

  useEffect(() => {
    setLoading(true)
    const q = debouncedSearch ? `?search=${encodeURIComponent(debouncedSearch)}` : ""
    fetch(`/api/admin/users${q}`)
      .then((r) => r.json())
      .then(setUsers)
      .finally(() => setLoading(false))
  }, [debouncedSearch])

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-[#E7E7E7]">Users</h1>

      <div className="rounded-2xl border border-[#1F1F1F] bg-[#141414] p-4">
        <input
          type="search"
          placeholder="Search by email or name..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full max-w-md rounded-xl border border-[#333] bg-[#0D0D0D] px-4 py-2.5 text-[#E7E7E7] placeholder:text-[#666] focus:border-[#F7931A] focus:outline-none focus:ring-1 focus:ring-[#F7931A]"
        />
      </div>

      <div className="overflow-hidden rounded-2xl border border-[#1F1F1F] bg-[#141414]">
        {loading ? (
          <div className="p-8 text-center text-[#919191]">Loading...</div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#1F1F1F]">
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-[#919191]">Email</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-[#919191]">Name</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-[#919191]">Role</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-[#919191]">Tier</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-[#919191]">Transactions</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-[#919191]">Joined</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-[#1F1F1F] last:border-0">
                  <td className="px-4 py-3 text-[#E7E7E7]">{u.email ?? "—"}</td>
                  <td className="px-4 py-3 text-[#E7E7E7]">{u.name ?? "—"}</td>
                  <td className="px-4 py-3 text-[#E7E7E7]">{u.role ?? "—"}</td>
                  <td className="px-4 py-3">
                    <select
                      value={u.subscriptionTier ?? "free"}
                      onChange={(e) =>
                        setTier(u.id, e.target.value as "free" | "premium")
                      }
                      disabled={updatingId === u.id}
                      className="rounded-lg border border-[#333] bg-[#0D0D0D] px-2.5 py-1.5 text-sm text-[#E7E7E7] focus:border-[#F7931A] focus:outline-none focus:ring-1 focus:ring-[#F7931A] disabled:opacity-50"
                    >
                      <option value="free">Free</option>
                      <option value="premium">Premium</option>
                    </select>
                  </td>
                  <td className="px-4 py-3 text-[#E7E7E7]">{u.transactionCount}</td>
                  <td className="px-4 py-3 text-[#919191]">
                    {new Date(u.createdAt).toLocaleDateString()}
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
