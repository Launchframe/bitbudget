export const AUTH_ERROR_MESSAGES: Record<string, string> = {
  AccessDenied: "Sign-in was denied. Please try again.",
  Configuration:
    "We are having trouble signing you in with this method. Please try signing in again, or use another sign-in method while we sort it out.",
  OAuthAccountNotLinked:
    "That email is already tied to a BitBudget account, but not to this sign-in provider. Sign in with your original method, or use email sign-in for this address.",
  Verification: "That sign-in link is invalid or has expired. Please request a new code.",
}

export function authErrorMessage(code: string | null | undefined) {
  return code && AUTH_ERROR_MESSAGES[code]
    ? AUTH_ERROR_MESSAGES[code]
    : "Something went wrong while signing you in. Please try again."
}
