"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useParams } from "next/navigation"

export default function AdminOfferDetailPage() {
  const params = useParams()
  const id = typeof params.id === "string" ? params.id : ""
  const [data, setData] = useState<{
    code: string
    label: string | null
    visitCount: number
    usedCount: number
    maxUses: number
    referralCount: number
    activatedCount: number
    medianTimeToActivationMs: number | null
    kFactor: number
    trialToPaidRate: number
    users: Array<{
      refereeId: string
      name: string | null
      email: string | null
      signupAt: string
      status: string
      transactionCount: number
      subscriptionTier: string
    }>
  } | null>(null)

  useEffect(() => {
    if (!id) return
    fetch(`/api/admin/offers/${id}/stats`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setData)
  }, [id])

  if (!data) {
    return <div className="p-8 text-[#919191]">Loading…</div>
  }

  return (
    <div className="space-y-8">
      <Link href="/admin/offers" className="text-sm text-[#F7931A] hover:underline">
        ← Offers
      </Link>
      <h1 className="text-2xl font-bold text-[#E7E7E7]">
        Offer <span className="font-mono text-[#F7931A]">{data.code}</span>
      </h1>
      {data.label && <p className="text-[#919191]">{data.label}</p>}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Mini label="Visits" value={data.visitCount} />
        <Mini label="Signups" value={data.usedCount} />
        <Mini label="Activated" value={data.activatedCount} />
        <Mini label="Median TTA (ms)" value={data.medianTimeToActivationMs ?? 0} />
      </div>
      <p className="text-sm text-[#919191]">
        K-factor: {(data.kFactor * 100).toFixed(1)}% · Trial→paid (expired trials):{" "}
        {(data.trialToPaidRate * 100).toFixed(1)}%
      </p>

      <div className="overflow-hidden rounded-2xl border border-[#1F1F1F] bg-[#141414]">
        <h2 className="text-lg font-semibold text-[#E7E7E7] p-4 border-b border-[#1F1F1F]">Users</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#1F1F1F] text-left text-xs uppercase text-[#919191]">
              <th className="px-4 py-3">User</th>
              <th className="px-4 py-3">Signup</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Txns</th>
              <th className="px-4 py-3">Tier</th>
            </tr>
          </thead>
          <tbody>
            {data.users.map((u) => (
              <tr key={u.refereeId} className="border-b border-[#1F1F1F] text-[#CCC]">
                <td className="px-4 py-2">{u.email ?? u.name ?? u.refereeId.slice(0, 8)}</td>
                <td className="px-4 py-2">{new Date(u.signupAt).toLocaleDateString()}</td>
                <td className="px-4 py-2">{u.status}</td>
                <td className="px-4 py-2">{u.transactionCount}</td>
                <td className="px-4 py-2">{u.subscriptionTier}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Mini({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-[#1F1F1F] bg-[#141414] p-4">
      <p className="text-xs text-[#919191]">{label}</p>
      <p className="text-xl font-bold text-[#F7931A]">{value}</p>
    </div>
  )
}
