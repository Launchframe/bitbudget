"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"

interface OpsSummary {
  health: { ok?: boolean; db?: boolean; schema?: boolean; httpStatus?: number; ts?: string }
  recentFailures: OpsEventRow[]
  latestCronRuns: CronRunRow[]
  pendingSenders: number
}

interface OpsEventRow {
  id: string
  severity: string
  source: string
  title: string
  body: string
  fingerprint: string | null
  sentryEventId: string | null
  createdAt: string
}

interface CronRunRow {
  id: string
  name: string
  status: string
  startedAt: string
  finishedAt: string | null
  durationMs: number | null
  errorClass: string | null
  errorMessage: string | null
  processed: number | null
}

export default function AdminOpsPage() {
  const [summary, setSummary] = useState<OpsSummary | null>(null)
  const [events, setEvents] = useState<OpsEventRow[]>([])
  const [severityFilter, setSeverityFilter] = useState("")
  const [testLoading, setTestLoading] = useState(false)
  const [testResult, setTestResult] = useState<string | null>(null)

  const load = useCallback(() => {
    fetch("/api/admin/ops/summary")
      .then(r => r.json())
      .then(setSummary)
      .catch(() => setSummary(null))

    const q = severityFilter ? `?severity=${encodeURIComponent(severityFilter)}` : ""
    fetch(`/api/admin/ops/events${q}`)
      .then(r => r.json())
      .then(setEvents)
      .catch(() => setEvents([]))
  }, [severityFilter])

  useEffect(() => {
    load()
  }, [load])

  async function sendTestAlert() {
    setTestLoading(true)
    setTestResult(null)
    try {
      const res = await fetch("/api/admin/ops/test-alert", { method: "POST" })
      const j = (await res.json()) as { ok?: boolean; eventId?: string; sent?: boolean }
      setTestResult(res.ok ? `Test alert recorded (${j.sent ? "channels sent" : "dedup/skipped channels"})` : "Failed")
      load()
    } catch {
      setTestResult("Failed")
    } finally {
      setTestLoading(false)
    }
  }

  const healthOk = summary?.health?.ok === true

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-[#E7E7E7]">Ops</h1>
        <button
          type="button"
          disabled={testLoading}
          onClick={() => void sendTestAlert()}
          className="rounded-lg border border-[#333] bg-[#1A1A1A] px-4 py-2 text-sm text-[#E7E7E7] hover:bg-[#222] disabled:opacity-50"
        >
          {testLoading ? "Sending…" : "Send test alert"}
        </button>
      </div>
      {testResult && <p className="text-sm text-[#919191]">{testResult}</p>}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Tile
          label="Health"
          value={healthOk ? "OK" : "Degraded"}
          tone={healthOk ? "ok" : "bad"}
          detail={
            summary?.health
              ? `DB: ${summary.health.db ? "up" : "down"} · Schema: ${summary.health.schema ? "ok" : "drift"}`
              : "Loading…"
          }
        />
        <Tile
          label="Pending senders"
          value={String(summary?.pendingSenders ?? "—")}
          tone="neutral"
          detail={
            <Link href="/admin/sender-review" className="text-[#F7931A] underline underline-offset-2">
              Review queue
            </Link>
          }
        />
        <Tile
          label="Recent errors"
          value={String(summary?.recentFailures?.length ?? "—")}
          tone={(summary?.recentFailures?.length ?? 0) > 0 ? "warn" : "ok"}
          detail="Last 10 error/page events"
        />
        <Tile
          label="Crons tracked"
          value={String(summary?.latestCronRuns?.length ?? "—")}
          tone="neutral"
          detail="Latest run per job"
        />
      </div>

      <section className="rounded-2xl border border-[#1F1F1F] bg-[#141414] p-6">
        <h2 className="text-lg font-semibold text-[#E7E7E7] mb-4">Cron runs (latest per job)</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#1F1F1F] text-left text-xs uppercase text-[#919191]">
                <th className="px-3 py-2">Job</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Started</th>
                <th className="px-3 py-2">Duration</th>
                <th className="px-3 py-2">Error</th>
              </tr>
            </thead>
            <tbody>
              {(summary?.latestCronRuns ?? []).map(run => (
                <tr key={run.id} className="border-b border-[#1F1F1F]/50">
                  <td className="px-3 py-2 font-mono text-xs">{run.name}</td>
                  <td className="px-3 py-2">
                    <StatusBadge status={run.status} />
                  </td>
                  <td className="px-3 py-2 text-[#919191]">{new Date(run.startedAt).toLocaleString()}</td>
                  <td className="px-3 py-2 text-[#919191]">
                    {run.durationMs != null ? `${run.durationMs}ms` : "—"}
                  </td>
                  <td className="px-3 py-2 text-xs text-red-300 max-w-xs truncate">
                    {run.errorClass ? `${run.errorClass}: ${run.errorMessage ?? ""}` : "—"}
                  </td>
                </tr>
              ))}
              {(summary?.latestCronRuns?.length ?? 0) === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-[#666]">
                    No cron runs recorded yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-2xl border border-[#1F1F1F] bg-[#141414] p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h2 className="text-lg font-semibold text-[#E7E7E7]">Ops events</h2>
          <select
            value={severityFilter}
            onChange={e => setSeverityFilter(e.target.value)}
            className="rounded-lg border border-[#333] bg-[#0D0D0D] px-3 py-2 text-sm text-[#E7E7E7]"
          >
            <option value="">All severities</option>
            <option value="page">page</option>
            <option value="error">error</option>
            <option value="warn">warn</option>
            <option value="info">info</option>
          </select>
        </div>
        <div className="space-y-3">
          {events.map(ev => (
            <div key={ev.id} className="rounded-xl border border-[#1F1F1F] bg-[#0D0D0D] p-4">
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <SeverityBadge severity={ev.severity} />
                <span className="text-sm font-medium text-[#E7E7E7]">{ev.title}</span>
                <span className="text-xs text-[#666]">{ev.source}</span>
              </div>
              <p className="text-sm text-[#919191] whitespace-pre-wrap">{ev.body}</p>
              <p className="text-xs text-[#666] mt-2">{new Date(ev.createdAt).toLocaleString()}</p>
            </div>
          ))}
          {events.length === 0 && <p className="text-sm text-[#666]">No ops events yet.</p>}
        </div>
      </section>

      <p className="text-xs text-[#666]">
        Configure Better Stack to ping <code className="text-[#919191]">/api/health</code> and relay alerts to{" "}
        <code className="text-[#919191]">/api/alerts/incoming</code>. See{" "}
        <code className="text-[#919191]">docs/ops/triage.md</code>.
      </p>
    </div>
  )
}

function Tile({
  label,
  value,
  detail,
  tone,
}: {
  label: string
  value: string
  detail: React.ReactNode
  tone: "ok" | "bad" | "warn" | "neutral"
}) {
  const border =
    tone === "ok"
      ? "border-[#22C55E]/30"
      : tone === "bad"
        ? "border-red-500/30"
        : tone === "warn"
          ? "border-[#EAB308]/30"
          : "border-[#1F1F1F]"
  return (
    <div className={`rounded-2xl border ${border} bg-[#141414] p-4`}>
      <p className="text-xs uppercase tracking-wider text-[#919191]">{label}</p>
      <p className="text-2xl font-bold text-[#E7E7E7] mt-1">{value}</p>
      <div className="text-xs text-[#666] mt-2">{detail}</div>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === "success"
      ? "bg-[#22C55E]/10 text-[#86EFAC]"
      : status === "failure"
        ? "bg-red-500/10 text-red-300"
        : "bg-[#333]/50 text-[#919191]"
  return <span className={`rounded px-2 py-0.5 text-xs font-medium ${cls}`}>{status}</span>
}

function SeverityBadge({ severity }: { severity: string }) {
  const cls =
    severity === "page" || severity === "error"
      ? "bg-red-500/10 text-red-300"
      : severity === "warn"
        ? "bg-[#EAB308]/10 text-[#FDE047]"
        : "bg-[#333]/50 text-[#919191]"
  return <span className={`rounded px-2 py-0.5 text-xs font-medium uppercase ${cls}`}>{severity}</span>
}
