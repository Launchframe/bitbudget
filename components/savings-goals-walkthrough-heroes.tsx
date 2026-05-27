"use client"

import type { ReactElement, ReactNode } from "react"
import type { SavingsGoalsWalkthroughSlideId } from "@/lib/savings-goals-walkthrough-slides"
import { SAVINGS_GOLD_ACCENT } from "@/lib/constants"

const GOLD = SAVINGS_GOLD_ACCENT
const GOLD_SOFT = `${SAVINGS_GOLD_ACCENT}33`

function HeroFrame({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 160 160"
      width={112}
      height={112}
      role="img"
      aria-hidden
      className="shrink-0"
    >
      <circle cx="80" cy="82" r="72" fill={GOLD_SOFT} />
      {children}
    </svg>
  )
}

function HeroIdea() {
  return (
    <HeroFrame>
      <ellipse cx="80" cy="92" rx="36" ry="28" fill="#1A1A1A" stroke={GOLD} strokeWidth="3" />
      <circle cx="68" cy="48" r="8" fill="#1A1A1A" stroke={GOLD} strokeWidth="3" />
      <circle cx="92" cy="48" r="8" fill="#1A1A1A" stroke={GOLD} strokeWidth="3" />
      <rect x="64" y="56" width="32" height="6" rx="3" fill={GOLD} opacity="0.5" />
      <path d="M72 108 Q80 118 88 108" fill="none" stroke={GOLD} strokeWidth="3" strokeLinecap="round" />
      <path d="M108 72 L118 82 L108 92" fill="none" stroke={GOLD} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </HeroFrame>
  )
}

function HeroMonthStarts() {
  return (
    <HeroFrame>
      <rect x="44" y="48" width="72" height="64" rx="8" fill="#1A1A1A" stroke={GOLD} strokeWidth="3" />
      <rect x="44" y="48" width="72" height="18" rx="8" fill={GOLD} opacity="0.35" />
      <circle cx="64" cy="82" r="5" fill={GOLD} opacity="0.4" />
      <circle cx="80" cy="82" r="5" fill={GOLD} />
      <circle cx="96" cy="82" r="5" fill={GOLD} opacity="0.4" />
      <circle cx="80" cy="98" r="8" fill="none" stroke={GOLD} strokeWidth="3" />
      <circle cx="80" cy="98" r="3" fill={GOLD} />
    </HeroFrame>
  )
}

function HeroFirstWeek() {
  return (
    <HeroFrame>
      <rect x="48" y="52" width="64" height="56" rx="6" fill="#1A1A1A" stroke={GOLD} strokeWidth="3" />
      <path d="M48 68 H112" stroke={GOLD} strokeWidth="2" opacity="0.5" />
      <rect x="58" y="78" width="20" height="3" rx="1.5" fill={GOLD} opacity="0.5" />
      <rect x="58" y="86" width="28" height="3" rx="1.5" fill={GOLD} opacity="0.35" />
      <path d="M100 74 L118 92 L100 110" fill="none" stroke={GOLD} strokeWidth="3" strokeLinejoin="round" />
      <path d="M108 92 L118 92" stroke={GOLD} strokeWidth="3" strokeLinecap="round" />
    </HeroFrame>
  )
}

function HeroAfterThat() {
  return (
    <HeroFrame>
      <rect x="58" y="70" width="44" height="36" rx="6" fill="#1A1A1A" stroke={GOLD} strokeWidth="3" />
      <path d="M72 82 V98" stroke={GOLD} strokeWidth="3" strokeLinecap="round" />
      <path d="M88 82 V98" stroke={GOLD} strokeWidth="3" strokeLinecap="round" />
      <path d="M68 70 V58" stroke={GOLD} strokeWidth="3" strokeLinecap="round" />
      <path d="M92 70 V58" stroke={GOLD} strokeWidth="3" strokeLinecap="round" />
      <path d="M64 58 H96" stroke={GOLD} strokeWidth="3" strokeLinecap="round" />
      <path d="M80 44 L80 28" stroke={GOLD} strokeWidth="3" strokeLinecap="round" />
      <path d="M72 36 L80 28 L88 36" fill="none" stroke={GOLD} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </HeroFrame>
  )
}

function HeroMonthEnds() {
  return (
    <HeroFrame>
      <path
        d="M80 38 L88 58 H108 L92 72 L96 92 L80 82 L64 92 L68 72 L52 58 H72 Z"
        fill="#1A1A1A"
        stroke={GOLD}
        strokeWidth="3"
        strokeLinejoin="round"
      />
      <path
        d="M48 108 Q56 96 64 108 T80 108 T96 108 T112 108"
        fill="none"
        stroke={GOLD}
        strokeWidth="3"
        strokeLinecap="round"
        opacity="0.7"
      />
    </HeroFrame>
  )
}

function HeroReady() {
  return (
    <HeroFrame>
      <ellipse cx="80" cy="96" rx="32" ry="24" fill="#1A1A1A" stroke={GOLD} strokeWidth="3" />
      <circle cx="68" cy="52" r="7" fill="#1A1A1A" stroke={GOLD} strokeWidth="3" />
      <circle cx="92" cy="52" r="7" fill="#1A1A1A" stroke={GOLD} strokeWidth="3" />
      <path d="M72 104 Q80 114 88 104" fill="none" stroke={GOLD} strokeWidth="3" strokeLinecap="round" />
      <path d="M48 72 L38 58" stroke={GOLD} strokeWidth="3" strokeLinecap="round" />
      <path d="M112 72 L122 58" stroke={GOLD} strokeWidth="3" strokeLinecap="round" />
      <path
        d="M118 38 L122 46 L130 48 L124 54 L125 62 L118 58 L111 62 L112 54 L106 48 L114 46 Z"
        fill={GOLD}
        opacity="0.85"
      />
      <circle cx="42" cy="42" r="4" fill={GOLD} opacity="0.6" />
      <circle cx="128" cy="88" r="3" fill={GOLD} opacity="0.5" />
    </HeroFrame>
  )
}

const HERO_BY_ID: Record<SavingsGoalsWalkthroughSlideId, () => ReactElement> = {
  idea: HeroIdea,
  "month-starts": HeroMonthStarts,
  "first-week": HeroFirstWeek,
  "after-that": HeroAfterThat,
  "month-ends": HeroMonthEnds,
  ready: HeroReady,
}

export function SavingsGoalsWalkthroughHero({ slideId }: { slideId: SavingsGoalsWalkthroughSlideId }) {
  const Hero = HERO_BY_ID[slideId]
  return <Hero />
}
