# Followups

When Claude Code notices an issue or improvement outside the current task's scope, it logs it here instead of fixing inline. The founder reviews at phase boundaries.

Format: date, severity, phase noticed, description, suggested fix.

## Template

```
## YYYY-MM-DD — [severity] — Phase N

**Noticed:** <what>
**Suggested fix:** <what>
**Cost estimate:** <hours>
**Blocks?:** <phase or feature this blocks if any>
```

Severity values: `critical` (security or data loss), `high` (user-facing bug), `medium` (dev experience), `low` (nits).

## 2026-04-24 — [medium] — Phase 1

**Noticed:** `@sentry/nextjs` is not in `package.json`. `src/lib/observability.ts` is an env-gated wrapper that console-logs when `SENTRY_DSN` is set but has no real Sentry SDK integration.
**Suggested fix:** Add `@sentry/nextjs` when a Sentry org exists. Wire `instrumentation.ts` and `sentry.*.config.ts`. Keep the env-gated noop as a fallback for environments without a DSN.
**Cost estimate:** 1–2 hours.
**Blocks?:** Cross-cutting acceptance "Sentry captures errors from web and workers." Not blocking Phase 1 go/no-go.

## 2026-04-24 — [medium] — Phase 1

**Noticed:** Axiom has no first-party Node SDK for this use case. We stub structured logging with `console.log` inside `src/lib/observability.ts`.
**Suggested fix:** Either switch to `pino` + Axiom's ingest endpoint, or pick another structured logger (Logtail, Datadog). Decide in Phase 5 before we have non-trivial traffic.
**Cost estimate:** 2 hours.
**Blocks?:** No.

## 2026-04-24 — [medium] — Phase 1

**Noticed:** The `.github/workflows/ci.yml` does not deploy to Vercel. The original build plan asked for PR preview + prod deploys. We deferred because Vercel tokens are not configured.
**Suggested fix:** Add a conditional `vercel` job gated on `secrets.VERCEL_TOKEN != ''` once the Vercel project exists.
**Cost estimate:** 30 minutes.
**Blocks?:** No. Cross-cutting acceptance lets us ship without automated deploys as long as tests pass.

## 2026-04-24 — [low] — Phase 1

**Noticed:** Marketing page mentions `docs/self-hosting.md` but that doc does not exist yet.
**Suggested fix:** Write the self-hosting guide. Cover Supabase bring-up, Clerk config, env vars, migrations, and the Docker path for the worker. The `.env.example` already enumerates every variable.
**Cost estimate:** 2 hours.
**Blocks?:** Public launch only. Not Phase 1 go/no-go.

## 2026-04-24 — [low] — Phase 1

**Noticed:** Waitlist submissions are logged via `observability.logAction` but not persisted to a database table.
**Suggested fix:** Add a `waitlist_signups` Supabase table (email, org, org_type, interest, created_at) behind `service_role`-only RLS. Write the `/api/waitlist` handler to insert.
**Cost estimate:** 1 hour.
**Blocks?:** No, not until we actually start marketing.

## 2026-04-24 — [low] — Phase 1

**Noticed:** `docs/09-acceptance-criteria.md` references a `/docs/self-hosting.md` and a `/CONTRIBUTING.md` plus code of conduct that do not yet exist. Needed before the repo is advertised publicly.
**Suggested fix:** Add `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, a `GOVERNANCE.md` describing the Indigenous Data Advisory Council, and a self-hosting guide.
**Cost estimate:** 3 hours.
**Blocks?:** Public announcement, not Phase 1 acceptance.
