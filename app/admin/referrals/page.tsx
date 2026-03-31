"use client"

import { useEffect, useState } from "react"
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

export default function AdminReferralsPage() {
  const [data, setData] = useState<{
    summary: {
      totalAccepted: number
      totalActivated: number
      activeTrialUsers: number
      activeGratisUsers: number
      totalVisits: number
      totalCodeRedemptions: number
    }
    shareMethodBreakdown: { method: string; count: number }[]
    recent: Array<{
      id: string
      status: string
      shareMethod: string | null
      code: string
      codeType: string
      referrer: { email: string | null; name: string | null }
      referee: { email: string | null; name: string | null }
      acceptedAt: string
    }>
  } | null>(null)

  useEffect(() => {
    fetch("/api/admin/referrals")
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData(null))
  }, [])

  if (!data) {
    return <div className="p-8 text-[#919191]">Loading…</div>
  }

  const { summary, shareMethodBreakdown, recent } = data
  const visitToSignup =
    summary.totalVisits > 0 ? Math.round((summary.totalCodeRedemptions / summary.totalVisits) * 100) : 0
  const signupToAct =
    summary.totalCodeRedemptions > 0
      ? Math.round((summary.totalActivated / summary.totalCodeRedemptions) * 100)
      : 0

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold text-[#E7E7E7]">Referrals</h1>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Stat label="Referrals (accepted)" value={summary.totalAccepted} />
        <Stat label="Activations" value={summary.totalActivated} />
        <Stat label="Active trial users" value={summary.activeTrialUsers} />
        <Stat label="Active gratis (non-sub)" value={summary.activeGratisUsers} />
        <Stat label="Total link visits (all-time)" value={summary.totalVisits} />
        <Stat label="Code redemptions" value={summary.totalCodeRedemptions} />
      </div>

      <div className="rounded-2xl border border-[#1F1F1F] bg-[#141414] p-6">
        <h2 className="text-lg font-semibold text-[#E7E7E7] mb-2">Funnel (approx.)</h2>
        <p className="text-sm text-[#919191] mb-4">
          Visits → signups: {visitToSignup}% · Signups → activations: {signupToAct}%
        </p>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={shareMethodBreakdown}>
              <CartesianGrid strokeDasharray="3 3" stroke="#333" />
              <XAxis dataKey="method" stroke="#919191" fontSize={12} />
              <YAxis stroke="#919191" fontSize={12} />
              <Tooltip
                contentStyle={{ background: "#0D0D0D", border: "1px solid #333" }}
                labelStyle={{ color: "#E7E7E7" }}
              />
              <Bar dataKey="count" fill="#F7931A" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <p className="text-xs text-[#666] mt-2">Share method distribution (all-time)</p>
      </div>

      <div className="overflow-hidden rounded-2xl border border-[#1F1F1F] bg-[#141414]">
        <h2 className="text-lg font-semibold text-[#E7E7E7] p-4 border-b border-[#1F1F1F]">Recent</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#1F1F1F] text-left text-xs uppercase text-[#919191]">
              <th className="px-4 py-3">Referee</th>
              <th className="px-4 py-3">Referrer</th>
              <th className="px-4 py-3">Code</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Method</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {recent.map((r) => (
              <tr key={r.id} className="border-b border-[#1F1F1F] text-[#CCC]">
                <td className="px-4 py-2">{r.referee.email ?? r.referee.name ?? "—"}</td>
                <td className="px-4 py-2">{r.referrer.email ?? r.referrer.name ?? "—"}</td>
                <td className="px-4 py-2 font-mono">{r.code}</td>
                <td className="px-4 py-2">{r.codeType}</td>
                <td className="px-4 py-2">{r.shareMethod ?? "—"}</td>
                <td className="px-4 py-2">{r.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-[#1F1F1F] bg-[#141414] p-4">
      <p className="text-xs text-[#919191] uppercase tracking-wide">{label}</p>
      <p className="text-2xl font-bold text-[#F7931A] mt-1">{value}</p>
    </div>
  )
}
