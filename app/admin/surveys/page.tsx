"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { Button } from "@/components/ui/button"

type SurveyUser = {
  email: string | null
  name: string | null
  nostrPubkey?: string | null
}

type ResponseRow = {
  id: string
  user: SurveyUser
  triggerType: string
  rating: string | null
  favoriteFeature: string | null
  leastFavorite: string | null
  comments: string | null
  canContact: boolean | null
  completedAt: string | null
  updatedAt: string
}

const STOPWORDS = new Set([
  "that",
  "this",
  "with",
  "from",
  "have",
  "what",
  "when",
  "your",
  "just",
  "like",
  "they",
  "them",
  "very",
  "really",
  "about",
  "would",
  "could",
])

function userLabel(u: SurveyUser): string {
  if (u.email) return u.email
  if (u.nostrPubkey) return `${u.nostrPubkey.slice(0, 12)}…`
  if (u.name) return u.name
  return "—"
}

function topWords(texts: (string | null)[], limit: number): { word: string; count: number }[] {
  const freq = new Map<string, number>()
  for (const t of texts) {
    if (!t) continue
    for (const w of t.toLowerCase().split(/\W+/)) {
      if (w.length < 4 || STOPWORDS.has(w)) continue
      freq.set(w, (freq.get(w) ?? 0) + 1)
    }
  }
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([word, count]) => ({ word, count }))
}

export default function AdminSurveysPage() {
  const [draft, setDraft] = useState({
    rating: "" as "" | "up" | "down",
    trigger: "" as "" | "general" | "referrer" | "referee",
    completedOnly: false,
    since: "",
    until: "",
  })
  const [applied, setApplied] = useState(draft)

  const [data, setData] = useState<{
    summary: {
      total: number
      completed: number
      thumbsUpPct: number
      thumbsDownPct: number
      avgStep: number
    }
    responses: ResponseRow[]
  } | null>(null)

  const load = useCallback(() => {
    const p = new URLSearchParams()
    if (applied.rating) p.set("rating", applied.rating)
    if (applied.trigger) p.set("trigger", applied.trigger)
    if (applied.completedOnly) p.set("completedOnly", "1")
    if (applied.since.trim()) p.set("since", new Date(applied.since).toISOString())
    if (applied.until.trim()) p.set("until", new Date(applied.until).toISOString())
    const q = p.toString()
    fetch(q ? `/api/admin/surveys?${q}` : "/api/admin/surveys")
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData(null))
  }, [applied])

  useEffect(() => {
    let cancelled = false
    const t = window.setTimeout(() => {
      if (cancelled) return
      void load()
    }, 0)
    return () => {
      cancelled = true
      window.clearTimeout(t)
    }
  }, [load])

  const exportCsv = () => {
    if (!data?.responses.length) return
    const headers = [
      "email",
      "name",
      "nostr",
      "trigger",
      "rating",
      "favorite",
      "least",
      "comments",
      "contact",
      "completed",
      "updated",
    ]
    const lines = [headers.join(",")]
    for (const r of data.responses) {
      const esc = (s: string | null | undefined) =>
        `"${(s ?? "").replace(/"/g, '""')}"`
      lines.push(
        [
          esc(r.user.email),
          esc(r.user.name),
          esc(r.user.nostrPubkey ?? null),
          esc(r.triggerType),
          esc(r.rating),
          esc(r.favoriteFeature),
          esc(r.leastFavorite),
          esc(r.comments),
          r.canContact === null ? "" : r.canContact ? "yes" : "no",
          esc(r.completedAt),
          esc(r.updatedAt),
        ].join(","),
      )
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" })
    const a = document.createElement("a")
    a.href = URL.createObjectURL(blob)
    a.download = `surveys-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
  }

  const topFavorite = useMemo(
    () => topWords(data?.responses.map((r) => r.favoriteFeature) ?? [], 12),
    [data?.responses],
  )
  const topLeast = useMemo(
    () => topWords(data?.responses.map((r) => r.leastFavorite) ?? [], 12),
    [data?.responses],
  )

  if (!data) return <div className="p-8 text-[#919191]">Loading…</div>

  const chartData = [
    { name: "up", pct: Math.round(data.summary.thumbsUpPct * 100) },
    { name: "down", pct: Math.round(data.summary.thumbsDownPct * 100) },
  ]

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap justify-between gap-4">
        <h1 className="text-2xl font-bold text-[#E7E7E7]">Surveys</h1>
        <button
          type="button"
          onClick={exportCsv}
          className="rounded-xl border border-[#333] px-4 py-2 text-sm text-[#E7E7E7] hover:bg-[#1A1A1A]"
        >
          Export CSV
        </button>
      </div>

      <div className="flex flex-wrap items-end gap-4 rounded-2xl border border-[#1F1F1F] bg-[#141414] p-4">
        <label className="flex flex-col gap-1 text-xs text-[#919191]">
          Rating
          <select
            className="rounded-lg border border-[#333] bg-[#0D0D0D] px-3 py-2 text-sm text-[#E7E7E7]"
            value={draft.rating}
            onChange={(e) =>
              setDraft((d) => ({ ...d, rating: e.target.value as typeof d.rating }))
            }
          >
            <option value="">All</option>
            <option value="up">Thumbs up</option>
            <option value="down">Thumbs down</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-[#919191]">
          Trigger
          <select
            className="rounded-lg border border-[#333] bg-[#0D0D0D] px-3 py-2 text-sm text-[#E7E7E7]"
            value={draft.trigger}
            onChange={(e) =>
              setDraft((d) => ({ ...d, trigger: e.target.value as typeof d.trigger }))
            }
          >
            <option value="">All</option>
            <option value="general">General</option>
            <option value="referrer">Referrer</option>
            <option value="referee">Referee</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm text-[#CCC]">
          <input
            type="checkbox"
            checked={draft.completedOnly}
            onChange={(e) => setDraft((d) => ({ ...d, completedOnly: e.target.checked }))}
          />
          Completed only
        </label>
        <label className="flex flex-col gap-1 text-xs text-[#919191]">
          Updated from
          <input
            type="date"
            className="rounded-lg border border-[#333] bg-[#0D0D0D] px-3 py-2 text-sm text-[#E7E7E7]"
            value={draft.since}
            onChange={(e) => setDraft((d) => ({ ...d, since: e.target.value }))}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-[#919191]">
          Updated to
          <input
            type="date"
            className="rounded-lg border border-[#333] bg-[#0D0D0D] px-3 py-2 text-sm text-[#E7E7E7]"
            value={draft.until}
            onChange={(e) => setDraft((d) => ({ ...d, until: e.target.value }))}
          />
        </label>
        <Button
          type="button"
          className="bg-[#F7931A] text-[#0D0D0D]"
          onClick={() => setApplied({ ...draft })}
        >
          Apply filters
        </Button>
        <Button
          type="button"
          variant="outline"
          className="border-[#333]"
          onClick={() => {
            const empty = {
              rating: "" as const,
              trigger: "" as const,
              completedOnly: false,
              since: "",
              until: "",
            }
            setDraft(empty)
            setApplied(empty)
          }}
        >
          Reset
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Mini label="Responses" value={data.summary.total} />
        <Mini label="Completed" value={data.summary.completed} />
        <Mini label="Avg step" value={Math.round(data.summary.avgStep * 10) / 10} />
        <Mini label="Thumbs up %" value={Math.round(data.summary.thumbsUpPct * 100)} />
        <Mini label="Thumbs down %" value={Math.round(data.summary.thumbsDownPct * 100)} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-[#1F1F1F] bg-[#141414] p-4">
          <h2 className="text-sm font-semibold text-[#E7E7E7] mb-3">Top words — favorites</h2>
          <ul className="flex flex-wrap gap-2 text-xs text-[#CCC]">
            {topFavorite.length === 0 ? (
              <li className="text-[#919191]">No data in this filter set.</li>
            ) : (
              topFavorite.map((x) => (
                <li key={x.word} className="rounded-lg bg-[#1A1A1A] px-2 py-1">
                  {x.word}{" "}
                  <span className="text-[#F7931A]">({x.count})</span>
                </li>
              ))
            )}
          </ul>
        </div>
        <div className="rounded-2xl border border-[#1F1F1F] bg-[#141414] p-4">
          <h2 className="text-sm font-semibold text-[#E7E7E7] mb-3">Top words — least favorite</h2>
          <ul className="flex flex-wrap gap-2 text-xs text-[#CCC]">
            {topLeast.length === 0 ? (
              <li className="text-[#919191]">No data in this filter set.</li>
            ) : (
              topLeast.map((x) => (
                <li key={x.word} className="rounded-lg bg-[#1A1A1A] px-2 py-1">
                  {x.word}{" "}
                  <span className="text-[#F7931A]">({x.count})</span>
                </li>
              ))
            )}
          </ul>
        </div>
      </div>

      <div className="rounded-2xl border border-[#1F1F1F] bg-[#141414] p-6 h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#333" />
            <XAxis dataKey="name" stroke="#919191" />
            <YAxis stroke="#919191" />
            <Tooltip contentStyle={{ background: "#0D0D0D", border: "1px solid #333" }} />
            <Bar dataKey="pct" fill="#3B82F6" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="overflow-hidden rounded-2xl border border-[#1F1F1F] bg-[#141414]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#1F1F1F] text-left text-xs uppercase text-[#919191]">
              <th className="px-4 py-3">User</th>
              <th className="px-4 py-3">Trigger</th>
              <th className="px-4 py-3">Rating</th>
              <th className="px-4 py-3">Favorite</th>
              <th className="px-4 py-3">Least</th>
              <th className="px-4 py-3">Comments</th>
              <th className="px-4 py-3">Done</th>
            </tr>
          </thead>
          <tbody>
            {data.responses.map((r) => (
              <tr key={r.id} className="border-b border-[#1F1F1F] text-[#CCC]">
                <td className="px-4 py-2 max-w-[200px] truncate" title={userLabel(r.user)}>
                  {userLabel(r.user)}
                </td>
                <td className="px-4 py-2">{r.triggerType}</td>
                <td className="px-4 py-2">{r.rating ?? "—"}</td>
                <td className="px-4 py-2 max-w-[160px] truncate">{r.favoriteFeature ?? "—"}</td>
                <td className="px-4 py-2 max-w-[160px] truncate">{r.leastFavorite ?? "—"}</td>
                <td className="px-4 py-2 max-w-[200px] truncate">{r.comments ?? "—"}</td>
                <td className="px-4 py-2">{r.completedAt ? "yes" : "partial"}</td>
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
