/**
 * True in development, test, preview, and any non-production build.
 * Use to gate dev-only logging or diagnostics.
 */
export function isDebugEnvironment(): boolean {
  return process.env.NODE_ENV !== "production"
}
