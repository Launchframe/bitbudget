function VanillaEnvelopeMark({ className }: { className?: string }) {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`shrink-0 ${className ?? ""}`}
      aria-hidden
    >
      <circle cx="16" cy="16" r="16" fill="#22C55E" />
      <rect x="11" y="7" width="10" height="6" rx="1" fill="#FDE047" />
      <line x1="13" y1="9.5" x2="19" y2="9.5" stroke="#CA8A04" strokeWidth="0.75" strokeLinecap="round" />
      <line x1="13" y1="11" x2="19" y2="11" stroke="#CA8A04" strokeWidth="0.75" strokeLinecap="round" />
      <rect x="5" y="11" width="22" height="14" rx="2" fill="white" />
      <path
        d="M5 13L16 20.5L27 13"
        stroke="#22C55E"
        strokeWidth="1.5"
        strokeLinejoin="round"
        fill="none"
      />
      <path d="M5 25L13 18.5" stroke="#22C55E" strokeWidth="1" strokeLinecap="round" fill="none" />
      <path d="M27 25L19 18.5" stroke="#22C55E" strokeWidth="1" strokeLinecap="round" fill="none" />
    </svg>
  )
}

function BitcoinMark({ className }: { className?: string }) {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`shrink-0 ${className ?? ""}`}
      aria-hidden
    >
      <circle cx="16" cy="16" r="16" fill="#F7931A" />
      <path
        d="M22.4 14.1c.3-2-1.2-3.1-3.3-3.8l.7-2.7-1.7-.4-.7 2.6c-.4-.1-.9-.2-1.4-.3l.7-2.7-1.7-.4-.7 2.7c-.3-.1-.7-.2-1-.2l-2.3-.6-.4 1.8s1.2.3 1.2.3c.7.2.8.6.8 1l-.8 3.3c0 .1.1.1.1.1h-.1l-1.2 4.6c-.1.2-.3.5-.8.4 0 0-1.2-.3-1.2-.3l-.8 1.9 2.2.6c.4.1.8.2 1.2.3l-.7 2.8 1.7.4.7-2.7c.5.1.9.2 1.4.3l-.7 2.7 1.7.4.7-2.8c2.8.5 5 .3 5.9-2.3.7-2.1 0-3.3-1.5-4.1 1.1-.3 1.9-1 2.1-2.5zm-3.8 5.3c-.5 2.1-4 1-5.2.7l.9-3.7c1.1.3 4.8.8 4.3 3zm.5-5.4c-.5 1.9-3.4.9-4.3.7l.8-3.4c1 .2 4 .7 3.5 2.7z"
        fill="#fff"
      />
    </svg>
  )
}

export type BitbudgetLogoVariant = "btc" | "vanilla"

export function BitbudgetLogo({
  className,
  variant = "btc",
}: {
  className?: string
  variant?: BitbudgetLogoVariant
}) {
  const isVanilla = variant === "vanilla"

  return (
    <div className={`flex items-center gap-2.5 ${className ?? ""}`}>
      {isVanilla ? <VanillaEnvelopeMark /> : <BitcoinMark />}
      <span className="text-lg font-bold tracking-tight text-foreground">
        Bit
        <span className={isVanilla ? "text-[#22C55E]" : "text-[#F7931A]"}>Budget</span>
      </span>
    </div>
  )
}
