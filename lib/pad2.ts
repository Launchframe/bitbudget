/** Zero-pad a number to two digits (shared by payday keys and funding period helpers). */
export function pad2(n: number): string {
  return String(n).padStart(2, "0")
}
