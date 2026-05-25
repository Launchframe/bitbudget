import { formatUsd } from "@/lib/data"
import { SAVINGS_GOLD_ACCENT } from "@/lib/constants"
import type { YearEndRecapStats } from "@/lib/year-end-recap"

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function formatMonthLabel(periodKey: string): string {
  const [y, m] = periodKey.split("-")
  if (!y || !m) return periodKey
  const d = new Date(Number(y), Number(m) - 1, 1)
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric" })
}

export interface YearEndRecapEmailPayload extends YearEndRecapStats {
  btcEquivalentUsd?: number | null
}

export function yearEndRecapEmailSubject(year: number): string {
  return `Your ${year} savings recap — BitBudget`
}

export function buildYearEndRecapEmailHtml(payload: YearEndRecapEmailPayload): string {
  const best = payload.bestMonth
    ? `${formatMonthLabel(payload.bestMonth.periodKey)} (${formatUsd(payload.bestMonth.amount)})`
    : "—"
  const worst = payload.worstMonth
    ? `${formatMonthLabel(payload.worstMonth.periodKey)} (${formatUsd(payload.worstMonth.amount)})`
    : "—"
  const projection =
    payload.projection2030 != null
      ? formatUsd(payload.projection2030)
      : "Keep saving to unlock a projection"

  const btcLine =
    payload.btcEquivalentUsd != null && payload.btcEquivalentUsd > 0
      ? `<p style="color: #ccc; font-size: 15px;">That&apos;s about <strong>${escapeHtml(formatUsd(payload.btcEquivalentUsd))}</strong> in Bitcoin opportunity cost terms.</p>`
      : ""

  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
      <h2 style="color: ${SAVINGS_GOLD_ACCENT}; margin-bottom: 8px;">Your ${payload.year} savings recap</h2>
      <p style="color: #ccc; font-size: 15px;">Here&apos;s how your Savings journey looked last year.</p>
      <div style="background: #111; border-radius: 12px; padding: 20px; margin: 24px 0;">
        <p style="color: #ccc; margin: 0 0 8px;"><strong>Total saved:</strong> ${escapeHtml(formatUsd(payload.totalSaved))}</p>
        <p style="color: #ccc; margin: 0 0 8px;"><strong>Best month:</strong> ${escapeHtml(best)}</p>
        <p style="color: #ccc; margin: 0 0 8px;"><strong>Toughest month:</strong> ${escapeHtml(worst)}</p>
        <p style="color: #ccc; margin: 0 0 8px;"><strong>Longest streak:</strong> ${payload.longestStreak} month(s)</p>
        <p style="color: #ccc; margin: 0;"><strong>Achievements earned:</strong> ${payload.achievementsEarned}</p>
      </div>
      ${btcLine}
      <p style="color: #999; font-size: 13px;">At your recent pace, you could reach <strong>${escapeHtml(projection)}</strong> by 2030.</p>
      <p style="color: #666; font-size: 12px; margin-top: 24px;">Open BitBudget to see your full recap and share your card.</p>
    </div>`
}
