"use client"

import { useEffect, useState } from "react"

interface UserRow {
  id: string
  email: string | null
  name: string | null
  role: string | null
  createdAt: string
  transactionCount: number
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<UserRow[]>([])
  const [search, setSearch] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [loading, setLoading] = useState(true)

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
