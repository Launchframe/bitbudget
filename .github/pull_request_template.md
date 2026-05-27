## Summary

<!-- What changed and why? Bullet points are fine. -->

-

## Test plan

<!-- How did you verify this? Include viewports for UI changes (e.g. 390px, 320px). -->

-

## Screenshots / recordings

<!-- Optional. Delete this section if not applicable. -->

## Related issues

<!-- Link issues, discussions, or prior PRs. Delete if none. -->

-

---

## Developer checklist

Before requesting review, confirm each item:

- [ ] I ran **`pnpm lint`** (or relied on the pre-commit hook for eslint)
- [ ] I ran **`pnpm test`** (Vitest; or relied on the pre-commit hook)
- [ ] **I swear I ran `pnpm test:e2e`** (Playwright is not on pre-commit — run locally when your change touches auth, referrals, transactions, onboarding, layout, or API behavior covered by e2e)
- [ ] Database migrations are idempotent and committed with schema changes (if applicable)
- [ ] No sensitive data in logs, PR text, or commits (privacy keys, OTPs, decrypted payees, etc.)
- [ ] User-facing copy is plain language (no internal jargon in the UI)
