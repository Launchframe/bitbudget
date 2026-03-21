import { isDebugEnvironment } from "@/lib/debug-environment"

/**
 * Console-style logger that no-ops in production (`NODE_ENV === "production"`).
 */
export class DebugLogger {
  log(...args: Parameters<typeof console.log>): void {
    if (!isDebugEnvironment()) return
    console.log(...args)
  }

  info(...args: Parameters<typeof console.info>): void {
    if (!isDebugEnvironment()) return
    console.info(...args)
  }

  warn(...args: Parameters<typeof console.warn>): void {
    if (!isDebugEnvironment()) return
    console.warn(...args)
  }

  error(...args: Parameters<typeof console.error>): void {
    if (!isDebugEnvironment()) return
    console.error(...args)
  }
}

/** Shared instance for app-wide dev-only logging. */
export const debugLogger = new DebugLogger()
