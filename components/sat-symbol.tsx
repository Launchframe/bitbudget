/**
 * Satoshi unit mark (horizontal “stack” with top/bottom stems).
 * Fills with current text color for inline use next to amounts.
 */
export function SatSymbol({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 14 18"
      fill="currentColor"
      className={className}
      aria-hidden
    >
      {/* Top vertical */}
      <rect x="6" y="0" width="2" height="2" />
      {/* Three horizontal bars */}
      <rect x="1" y="4" width="12" height="2" />
      <rect x="1" y="8" width="12" height="2" />
      <rect x="1" y="12" width="12" height="2" />
      {/* Bottom vertical */}
      <rect x="6" y="16" width="2" height="2" />
    </svg>
  )
}
