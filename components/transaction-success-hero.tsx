"use client"

interface TransactionSuccessHeroProps {
  opportunityCostEnabled: boolean
}

/** Cheerful envelope mascot — vanilla green or Bitcoin orange accent. */
export function TransactionSuccessHero({ opportunityCostEnabled }: TransactionSuccessHeroProps) {
  const accent = opportunityCostEnabled ? "#F7931A" : "#22C55E"
  const accentSoft = opportunityCostEnabled ? "#F7931A33" : "#22C55E33"

  return (
    <svg
      viewBox="0 0 160 160"
      width={128}
      height={128}
      role="img"
      aria-hidden
      className="shrink-0 animate-[bounce_1.4s_ease-in-out_infinite]"
      style={{ transformOrigin: "center bottom" }}
    >
      <circle cx="80" cy="82" r="72" fill={accentSoft} />
      <path
        d="M32 52 L80 78 L128 52 L128 112 C128 118 123 123 117 123 L43 123 C37 123 32 118 32 112 Z"
        fill="#1A1A1A"
        stroke={accent}
        strokeWidth="4"
        strokeLinejoin="round"
      />
      <path
        d="M32 52 L80 78 L128 52"
        fill="none"
        stroke={accent}
        strokeWidth="4"
        strokeLinejoin="round"
      />
      <circle cx="62" cy="88" r="5" fill={accent} />
      <circle cx="98" cy="88" r="5" fill={accent} />
      <path
        d="M58 104 Q80 118 102 104"
        fill="none"
        stroke={accent}
        strokeWidth="4"
        strokeLinecap="round"
      />
      <circle cx="118" cy="38" r="6" fill={accent} opacity="0.85" />
      <circle cx="42" cy="34" r="4" fill={accent} opacity="0.6" />
      <path
        d="M130 28 L134 36 L142 38 L136 44 L137 52 L130 48 L123 52 L124 44 L118 38 L126 36 Z"
        fill={accent}
        opacity="0.75"
      />
    </svg>
  )
}
