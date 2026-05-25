import * as Sentry from "@sentry/nextjs"
import { scrubSentryEvent } from "@/lib/sentry-scrub"

function sentryEnvironment(): string {
  if (process.env.VERCEL_ENV) return process.env.VERCEL_ENV
  if (process.env.NODE_ENV === "production") return "production"
  return "development"
}

export function baseSentryOptions(): Parameters<typeof Sentry.init>[0] {
  return {
    dsn: process.env.SENTRY_DSN,
    enabled: Boolean(process.env.SENTRY_DSN),
    environment: sentryEnvironment(),
    release: process.env.VERCEL_GIT_COMMIT_SHA,
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 0,
    beforeSend: (event, hint) =>
      scrubSentryEvent(event as Parameters<typeof scrubSentryEvent>[0], hint) as typeof event | null,
    ignoreErrors: [
      // Browser extensions / network noise
      "ResizeObserver loop limit exceeded",
      "Non-Error promise rejection captured",
    ],
  }
}
