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

## 2026-04-24 — [medium] — Phase 2

**Noticed:** The DB `documents.parse_status` CHECK enum is `('queued', 'parsing', 'parsed', 'failed')` but docs/08-ui-spec.md and the Phase 2 Documents task spec both reference an `indexed` terminal state. The web UI currently maps `parsed` to a badge labelled "Indexed" and treats the two as aliases.
**Suggested fix:** Decide whether "indexed" is a separate state representing "chunks + embeddings inserted" distinct from "parsed" (which would just mean "PDF extracted"). If yes, add a migration adding the `indexed` value and update the worker to emit it after the embedding pass. If no, update 08-ui-spec.md to say "parsed."
**Cost estimate:** 1 hour.
**Blocks?:** No. The alias is clearly documented in `src/lib/types/documents.ts`.

## 2026-04-24 — [low] — Phase 2

**Noticed:** Running `pnpm lint` from the worktree (`/home/user/auroragrants/.claude/worktrees/agent-*`) errors with `Plugin "@next/next" was conflicted` because ESLint's rc resolver walks up to the parent checkout's `.eslintrc.json`. Running from `/home/user/auroragrants/` directly (the ordinary repo checkout) lints cleanly.
**Suggested fix:** Either migrate both repos to flat config (`eslint.config.js`) which does not walk up, or add a `root: true` flag to the worktree's `.eslintrc.json`. Our project config is identical in both locations, so this is a harness-only issue.
**Cost estimate:** 15 minutes.
**Blocks?:** No. `pnpm build` still succeeds in both locations. CI runs outside worktrees.

## 2026-04-24 — [low] — Phase 2

**Noticed:** `src/app/api/documents/route.ts` uses a Supabase relational select (`*, chunks:document_chunks(count)`) which requires a foreign-key relationship to be declared in the schema cache. If the migration does not include `ON DELETE CASCADE` plus a named FK, Postgres will still accept it but the PostgREST select may fail or return null counts.
**Suggested fix:** When the seed agent finalizes `supabase/migrations/`, double-check that `document_chunks.document_id -> documents.id` is picked up by PostgREST. Add an end-to-end test that asserts `/api/documents` returns a numeric `chunk_count`.
**Cost estimate:** 30 minutes.
**Blocks?:** No. Falls back to 0 when the relation is missing.

## 2026-04-24 — [low] — Phase 2

**Noticed:** The `documents` table in `docs/02-data-model.md` has no `deleted_at` column, but the Documents API implements a soft delete by setting `deleted_at`. Either the schema docs need an update, or the implementation should use a different soft-delete convention.
**Suggested fix:** Add `deleted_at TIMESTAMPTZ` to the `documents` migration and filter it out of every select. Keep the column nullable so restorations are cheap. Parallel Supabase seed agent owns the migration.
**Cost estimate:** 15 minutes.
**Blocks?:** Soft delete silently fails without the column. Medium for a real deploy, low for CI since no DB is wired.
