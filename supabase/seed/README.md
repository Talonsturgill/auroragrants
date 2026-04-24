# Supabase Seed Data

## Applying the funder seed

```bash
# From the repo root, against your Supabase project:
psql "$SUPABASE_DB_URL" -f supabase/migrations/0001_initial.sql
psql "$SUPABASE_DB_URL" -f supabase/migrations/0002_test_helpers.sql
psql "$SUPABASE_DB_URL" -f supabase/migrations/0003_funders_seed.sql
```

The seed migration is idempotent. Running it again updates existing rows via `ON CONFLICT (slug) DO UPDATE`.

## Files

- `funders.json` — JSON mirror of `0003_funders_seed.sql` for use in tests and scripts.
- `rubrics/` — Hand-curated evaluation rubrics for the top 10 AK funders. Each file is a JSON array of rubric items used by the Writer-Critic-Editor loop to score AI-generated narrative fields.
- `funder_docs/` — Downloaded funder guidelines PDFs. Committed PDFs are named `{slug}.pdf`. These are ingested by the Phase 2 pipeline to populate `document_chunks` and `embeddings` tagged with `funder_id` (no `tenant_id`, shared reference data).

## Rubric format

Each rubric file contains an array of items matching this schema:

```json
{
  "id": "community_impact",
  "label": "Community impact",
  "weight": 0.25,
  "description": "Describe measurable impact...",
  "scoring": [
    {"score": 0, "desc": "Impact is vague..."},
    {"score": 1, "desc": "Impact is specific but limited..."},
    {"score": 2, "desc": "Impact is specific, measurable..."}
  ],
  "common_failures": ["Boilerplate language...", "Missing baseline data"]
}
```

Weights within a rubric must sum to 1.0. Run `node scripts/validate_funder_seed.mjs` to verify.

## Rubric slugs (top 10)

| Slug | Funder |
|------|--------|
| `rasmuson-tier-1` | Rasmuson Tier 1 |
| `rasmuson-legacy` | Rasmuson Legacy |
| `rasmuson-community-support` | Rasmuson Community Support |
| `mshf-healthy-impact` | Mat-Su Health Foundation Healthy Impact |
| `mshf-target-wellness` | Mat-Su Health Foundation Target Wellness |
| `acf-competitive` | Alaska Community Foundation Competitive |
| `ahfc-goal` | AHFC GOAL |
| `denali-commission` | Denali Commission |
| `hud-icdbg` | HUD ICDBG |
| `ihs-bh-aide` | IHS Behavioral Health Aide |

The remaining 20 funders have empty `rubric` arrays seeded in the migration. Rubric curation for those funders is planned for month 2.
