import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { notifyAdminsSurveyCompleted, userContactLabel } from "@/lib/notify"
import { computeSurveyEligibility } from "@/lib/survey-eligibility"

function surveyHasAnyResponse(s: {
  rating: string | null
  favoriteFeature: string | null
  leastFavorite: string | null
  comments: string | null
  canContact: boolean | null
}): boolean {
  return !!(
    s.rating ||
    s.favoriteFeature ||
    s.leastFavorite ||
    s.comments ||
    s.canContact !== null
  )
}

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const referrerHeader = req.headers.get("x-bitbudget-survey-referrer") === "1"

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      onboardingComplete: true,
      createdAt: true,
      referralReceived: { select: { id: true } },
      _count: { select: { transactions: true } },
    },
  })

  const row = await prisma.survey.findUnique({
    where: { userId: session.user.id },
  })

  const eligibility = user
    ? computeSurveyEligibility({
        onboardingComplete: user.onboardingComplete,
        createdAt: user.createdAt,
        transactionCount: user._count.transactions,
        hasReferralReceived: user.referralReceived !== null,
        survey: row
          ? {
              completedAt: row.completedAt,
              dismissType: row.dismissType,
              currentStep: row.currentStep,
            }
          : null,
        sessionReferrerTrigger: referrerHeader,
      })
    : { eligible: false, triggerType: null, resumeStep: 1 }

  return NextResponse.json({ survey: row, eligibility })
}

export async function PUT(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let body: { step?: number; value?: unknown; triggerType?: string; skip?: boolean }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const step = typeof body.step === "number" ? body.step : NaN
  if (step < 1 || step > 6 || !Number.isInteger(step)) {
    return NextResponse.json({ error: "step must be 1-6" }, { status: 400 })
  }

  const referrerHeader = req.headers.get("x-bitbudget-survey-referrer") === "1"

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      onboardingComplete: true,
      createdAt: true,
      referralReceived: { select: { id: true } },
      _count: { select: { transactions: true } },
    },
  })
  if (!user?.onboardingComplete) {
    return NextResponse.json({ error: "Survey not available" }, { status: 403 })
  }

  const prev = await prisma.survey.findUnique({
    where: { userId: session.user.id },
  })

  if (prev?.completedAt) {
    return NextResponse.json({ error: "Survey already completed" }, { status: 409 })
  }
  if (prev?.dismissType === "never") {
    return NextResponse.json({ error: "Survey dismissed" }, { status: 403 })
  }

  const eligibility = computeSurveyEligibility({
    onboardingComplete: user.onboardingComplete,
    createdAt: user.createdAt,
    transactionCount: user._count.transactions,
    hasReferralReceived: user.referralReceived !== null,
    survey: prev
      ? {
          completedAt: prev.completedAt,
          dismissType: prev.dismissType,
          currentStep: prev.currentStep,
        }
      : null,
    sessionReferrerTrigger: referrerHeader,
  })

  const continuingPartial =
    !!prev &&
    !prev.completedAt &&
    prev.dismissType !== "never" &&
    (prev.currentStep > 1 || surveyHasAnyResponse(prev))

  if (!eligibility.eligible && !continuingPartial) {
    return NextResponse.json({ error: "Survey not available" }, { status: 403 })
  }

  const triggerIn =
    typeof body.triggerType === "string" && body.triggerType.trim()
      ? body.triggerType.trim().slice(0, 32)
      : "general"

  const skipStep = body.skip === true

  const wasComplete = !!prev?.completedAt

  const prevHadNoResponses =
    !prev ||
    !surveyHasAnyResponse({
      rating: prev.rating,
      favoriteFeature: prev.favoriteFeature,
      leastFavorite: prev.leastFavorite,
      comments: prev.comments,
      canContact: prev.canContact,
    })
  const shouldRefreshTrigger =
    prevHadNoResponses || (prev?.triggerType === "general" && triggerIn !== "general")

  const patch: {
    rating?: string | null
    favoriteFeature?: string | null
    leastFavorite?: string | null
    comments?: string | null
    canContact?: boolean | null
    triggerType?: string
    currentStep?: number
    completedAt?: Date | null
  } = {}

  const rating = prev?.rating ?? null

  if (!skipStep) {
    switch (step) {
      case 1:
        if (body.value === "up" || body.value === "down") patch.rating = body.value
        break
      case 2:
        if (typeof body.value === "string" && body.value.trim()) {
          if (rating === "down") patch.leastFavorite = body.value.slice(0, 2000)
          else patch.favoriteFeature = body.value.slice(0, 2000)
        }
        break
      case 3:
        if (typeof body.value === "string" && body.value.trim()) {
          if (rating === "down") patch.favoriteFeature = body.value.slice(0, 2000)
          else patch.leastFavorite = body.value.slice(0, 2000)
        }
        break
      case 4:
        if (typeof body.value === "string" && body.value.trim()) {
          patch.comments = body.value.slice(0, 4000)
        }
        break
      case 5:
        if (body.value === true || body.value === false) patch.canContact = body.value
        break
      case 6:
        break
      default:
        break
    }
  }

  let nextStep = step === 6 ? 6 : step + 1

  if (step === 6) {
    const merged = {
      rating: patch.rating ?? prev?.rating ?? null,
      favoriteFeature: patch.favoriteFeature ?? prev?.favoriteFeature ?? null,
      leastFavorite: patch.leastFavorite ?? prev?.leastFavorite ?? null,
      comments: patch.comments ?? prev?.comments ?? null,
      canContact: patch.canContact ?? prev?.canContact ?? null,
    }
    if (surveyHasAnyResponse(merged)) {
      patch.completedAt = new Date()
    } else {
      // All skips on step 6: avoid leaving currentStep=6 with no completion (dead-end on next open).
      nextStep = 1
    }
  }

  patch.currentStep = nextStep

  const row = await prisma.survey.upsert({
    where: { userId: session.user.id },
    create: {
      userId: session.user.id,
      triggerType: triggerIn,
      rating: patch.rating ?? null,
      favoriteFeature: patch.favoriteFeature ?? null,
      leastFavorite: patch.leastFavorite ?? null,
      comments: patch.comments ?? null,
      canContact: patch.canContact ?? null,
      currentStep: nextStep,
      completedAt: patch.completedAt ?? null,
    },
    update: {
      ...(shouldRefreshTrigger ? { triggerType: triggerIn } : {}),
      ...(patch.rating !== undefined ? { rating: patch.rating } : {}),
      ...(patch.favoriteFeature !== undefined ? { favoriteFeature: patch.favoriteFeature } : {}),
      ...(patch.leastFavorite !== undefined ? { leastFavorite: patch.leastFavorite } : {}),
      ...(patch.comments !== undefined ? { comments: patch.comments } : {}),
      ...(patch.canContact !== undefined ? { canContact: patch.canContact } : {}),
      currentStep: nextStep,
      ...(patch.completedAt ? { completedAt: patch.completedAt } : {}),
    },
  })

  if (patch.completedAt && !wasComplete && surveyHasAnyResponse(row)) {
    const u = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { name: true, email: true, nostrPubkey: true },
    })
    await notifyAdminsSurveyCompleted({
      userLabel: userContactLabel(u ?? {}),
      triggerType: row.triggerType,
      rating: row.rating,
      favoriteFeature: row.favoriteFeature,
      leastFavorite: row.leastFavorite,
      comments: row.comments,
      canContact: row.canContact,
    })
  }

  return NextResponse.json({ survey: row })
}
