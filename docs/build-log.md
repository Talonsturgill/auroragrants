# Build Log

Append one line per phase-boundary event. Most recent at bottom.

Format: `YYYY-MM-DD HH:MM TZ | phase N | <status> | <tests>`

Status values: `started`, `acceptance_passed`, `acceptance_failed`, `blocked`.

Tests: short list of suites that passed or failed.

## Examples

```
2026-11-01 09:00 AKST | phase 1 | started | -
2026-11-01 18:30 AKST | phase 1 | acceptance_passed | tenant-isolation, lighthouse
2026-11-02 08:00 AKST | phase 2 | started | -
2026-11-02 22:00 AKST | phase 2 | acceptance_passed | parser-bakeoff=0.91 F1, retrieval-top3=0.95
```

## Actual entries

2026-04-24 01:42 AKDT | phase 1 | started | reorganized zipped layout; flat root duplicates removed
2026-04-24 02:11 AKDT | phase 1 | scaffolded | Next.js 15 + shadcn + Clerk + Supabase + tenant-isolation test helpers. Stripe deleted. Apache-2.0. pnpm typecheck + lint + vitest(3) + next build all green locally with placeholder Clerk+Supabase envs.

Pending acceptance items (require live services):
- tenant-isolation.spec.ts against a real Supabase (need a running project).
- Clerk sign-up flow end-to-end in a browser.
- Lighthouse 95+ performance score on `/` against a production build.
- CI green on the PR.
