export function parseCSVLine(line: string): string[] {
  const result: string[] = []
  let current = ""
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (char === "," && !inQuotes) {
      result.push(current.trim())
      current = ""
    } else {
      current += char
    }
  }
  result.push(current.trim())
  return result
}

export function parseDate(dateStr: string): string | null {
  const mmddyyyy = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (mmddyyyy) {
    const [, m, d, y] = mmddyyyy
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`
  }
  const iso = dateStr.match(/^\d{4}-\d{2}-\d{2}$/)
  if (iso) return dateStr
  return null
}

export interface ParsedTransaction {
  date: string
  payee: string
  amount: number
  type: "expense" | "credit"
  envelopeName: string
  notes: string | null
}

export interface CsvParseResult {
  transactions: ParsedTransaction[]
  envelopeCounts: Record<string, number>
  envelopeSamples: Record<string, { date: string; payee: string; amount: number }[]>
  totalRows: number
  skippedRows: number
}

const MAX_SAMPLES = 3

export function parseCSVFile(text: string): CsvParseResult {
  const lines = text.split("\n").filter(l => l.trim())
  if (lines.length < 2) {
    throw new Error("CSV file is empty or has no data rows")
  }

  const headers = parseCSVLine(lines[0]).map(h => h.toLowerCase().replace(/['"]/g, ""))

  const dateIdx = headers.findIndex(h => h === "date")
  const envelopeIdx = headers.findIndex(h => h === "envelope" || h === "category")
  const nameIdx = headers.findIndex(h => h === "name" || h === "payee" || h === "description")
  const amountIdx = headers.findIndex(h => h === "amount")
  const notesIdx = headers.findIndex(h => h === "notes" || h === "memo")

  if (dateIdx === -1 || amountIdx === -1) {
    throw new Error("CSV must have Date and Amount columns")
  }

  const transactions: ParsedTransaction[] = []
  const envelopeCounts: Record<string, number> = {}
  const envelopeSamples: Record<string, { date: string; payee: string; amount: number }[]> = {}
  let skippedRows = 0

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i])
    if (cols.length <= Math.max(dateIdx, amountIdx)) { skippedRows++; continue }

    const dateStr = parseDate(cols[dateIdx])
    if (!dateStr) { skippedRows++; continue }

    const rawAmount = parseFloat(cols[amountIdx]?.replace(/[$,]/g, ""))
    if (isNaN(rawAmount)) { skippedRows++; continue }

    const payee = nameIdx >= 0 ? cols[nameIdx] || "Unknown" : "Unknown"
    const type: "expense" | "credit" = rawAmount < 0 ? "expense" : "credit"
    const amount = Math.abs(rawAmount)
    const envelopeName = envelopeIdx >= 0 ? cols[envelopeIdx] || "Uncategorized" : "Uncategorized"
    const notes = notesIdx >= 0 && cols[notesIdx] ? cols[notesIdx] : null

    transactions.push({ date: dateStr, payee, amount, type, envelopeName, notes })

    envelopeCounts[envelopeName] = (envelopeCounts[envelopeName] || 0) + 1

    if (!envelopeSamples[envelopeName]) envelopeSamples[envelopeName] = []
    if (envelopeSamples[envelopeName].length < MAX_SAMPLES) {
      envelopeSamples[envelopeName].push({ date: cols[dateIdx] || "", payee, amount: rawAmount })
    }
  }

  return {
    transactions,
    envelopeCounts,
    envelopeSamples,
    totalRows: lines.length - 1,
    skippedRows,
  }
}
