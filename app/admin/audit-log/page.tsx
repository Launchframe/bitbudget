"use client"

import { useEffect, useState } from "react"
import { AUDIT_LOG_ACTIONS, AUDIT_LOG_ACTION_LABELS } from "@/lib/audit-log-actions"

interface AuditLogRow {
  id: string
  action: string
  targetType: string | null
  targetId: string | null
  metadata: Record<string, unknown> | null
  createdAt: string
  admin: { email: string | null; name: string | null }
}

const ACTION_OPTIONS = [
  { value: "", label: "All actions" },
  ...AUDIT_LOG_ACTIONS.map(action => ({
    value: action,
    label: AUDIT_LOG_ACTION_LABELS[action],
  })),
]

export default function AdminAuditLogPage() {
  const [logs, setLogs] = useState<AuditLogRow[]>([])
  const [actionFilter, setActionFilter] = useState("")
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- show loading immediately when filter or mount changes
    setLoading(true)
    const q = actionFilter ? `?action=${encodeURIComponent(actionFilter)}` : ""
    fetch(`/api/admin/audit-log${q}`)
      .then((r) => r.json())
      .then(setLogs)
      .finally(() => setLoading(false))
  }, [actionFilter])

  function formatTimestamp(iso: string) {
    const d = new Date(iso)
    return d.toLocaleString(undefined, {
      dateStyle: "short",
      timeStyle: "medium",
    })
  }

  function formatTarget(row: AuditLogRow) {
    if (row.targetType && row.targetId) return `${row.targetType}:${row.targetId}`
    return row.targetType ?? "—"
  }

  function formatDetails(row: AuditLogRow) {
    if (row.metadata && Object.keys(row.metadata).length > 0) {
      return JSON.stringify(row.metadata)
    }
    return "—"
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-[#E7E7E7]">Audit Log</h1>

      <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-[#1F1F1F] bg-[#141414] p-4">
        <label className="text-sm font-medium text-[#919191]">Filter by action</label>
        <select
          value={actionFilter}
          onChange={(e) => setActionFilter(e.target.value)}
          className="rounded-xl border border-[#333] bg-[#0D0D0D] px-4 py-2.5 text-[#E7E7E7] focus:border-[#F7931A] focus:outline-none focus:ring-1 focus:ring-[#F7931A]"
        >
          {ACTION_OPTIONS.map((opt) => (
            <option key={opt.value || "all"} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <div className="overflow-hidden rounded-2xl border border-[#1F1F1F] bg-[#141414]">
        {loading ? (
          <div className="p-8 text-center text-[#919191]">Loading...</div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#1F1F1F]">
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-[#919191]">Timestamp</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-[#919191]">Admin</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-[#919191]">Action</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-[#919191]">Target</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-[#919191]">Details</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((row) => (
                <tr key={row.id} className="border-b border-[#1F1F1F] last:border-0">
                  <td className="whitespace-nowrap px-4 py-3 text-[#919191]">
                    {formatTimestamp(row.createdAt)}
                  </td>
                  <td className="px-4 py-3 text-[#E7E7E7]">
                    {row.admin?.name || row.admin?.email || "—"}
                  </td>
                  <td className="px-4 py-3 font-mono text-sm text-[#E7E7E7]">{row.action}</td>
                  <td className="px-4 py-3 font-mono text-sm text-[#E7E7E7]">
                    {formatTarget(row)}
                  </td>
                  <td className="max-w-xs truncate px-4 py-3 font-mono text-xs text-[#919191]">
                    {formatDetails(row)}
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
