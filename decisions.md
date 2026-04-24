# Decisions Log

When Claude Code encounters ambiguity, records the decision here rather than guessing twice. Format: date, phase, decision, rationale.

## Template

```
## YYYY-MM-DD — Phase N — <short title>

**Decision:** <what was decided>
**Rationale:** <why>
**Alternatives considered:** <what else>
**Reversible?** <yes/no and under what conditions>
```

## Examples to follow

## 2026-11-01 — Phase 1 — Clerk vs Supabase Auth

**Decision:** Clerk.
**Rationale:** Clerk has first-class Organizations primitive that maps cleanly to `tenants`. Supabase Auth would require custom org-membership tables and more middleware.
**Alternatives considered:** Supabase Auth with custom org schema; Auth.js with database adapter.
**Reversible?** Yes at high cost. Would require rewriting auth middleware and migrating user IDs.

## 2026-11-01 — Phase 2 — Parser primary

**Decision:** <TBD after bake-off>
**Rationale:** <after running parser_bakeoff.py>
**Alternatives considered:** Marker, pdfplumber, Unstructured, LlamaParse.
**Reversible?** Yes. Parser is a pluggable service.
