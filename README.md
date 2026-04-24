# AuroraGrants

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](./LICENSE)
[![CI](https://github.com/Talonsturgill/auroragrants/actions/workflows/ci.yml/badge.svg)](https://github.com/Talonsturgill/auroragrants/actions/workflows/ci.yml)

Open-source, Alaska-specific AI grant-operations platform for nonprofits and tribal organizations. Free for every organization. No paid tiers.

Part of Arctic Intelligence (arcticintelligence.ai).

## What this is

AuroraGrants helps Alaska nonprofits and tribal organizations manage post-award federal and foundation grant compliance reporting. The v1 hero is post-award compliance: upload your award, we extract the reporting requirements, track deadlines, and draft each narrative field grounded in your own prior reports and program data, with inline citations, human review, and explicit sign-off before submission.

The whole product is free and open source under Apache-2.0. Host it yourself, fork it, change it. There is no hosted paid tier and no feature gating behind payment.

## Who it's for

- Anchorage 501(c)(3)s managing Rasmuson, Mat-Su Health Foundation, Alaska Community Foundation, Denali Commission, HUD, and HHS awards
- ANCSA regional nonprofits (Cook Inlet Tribal Council, Tanana Chiefs Conference, Bristol Bay Native Association, Kawerak, and the other eight) managing federal compacts and foundation grants
- Alaska tribes and tribal consortia requiring CARE-aligned data sovereignty

## Deployment modes

AuroraGrants is free. You choose how to run it.

- **Hosted (when available).** We operate a shared instance you can sign up for. No cost.
- **Self-hosted.** Clone the repo, bring your own Supabase, Clerk, and LLM keys, and deploy. A self-hosting guide lives in `docs/self-hosting.md` (ships Phase 1).
- **Sovereignty deployment.** A tribal organization can request a dedicated deployment with ZDR routing, BYOK encryption, offline CSV export and import, and a pre-signed Tribal Data Use Agreement. See `docs/03-sovereignty.md`. No tier fee.

## Non-negotiables

Every AI-generated narrative is a **draft requiring human sign-off before export**. Every AI-generated sentence carries an inline source citation. Tenant isolation is enforced at the database level with Supabase RLS. Tribal data sovereignty is the posture, not a paywall.

See `CLAUDE.md` for the full operating instructions and `docs/` for the specs.

## Building

This repo is intended to be read and executed by Claude Code. Humans welcome too.

**Prerequisites.** Node 22+, pnpm 9+, Python 3.12+ (for the worker), a Supabase project, and a Clerk application.

**Install and run.**

```bash
pnpm install
cp .env.example .env.local   # fill in your Clerk + Supabase keys
pnpm dev                     # Next.js app at http://localhost:3000
```

**Apply the database schema** to your Supabase project:

```bash
psql "$SUPABASE_DB_URL" -f supabase/migrations/0001_initial.sql
psql "$SUPABASE_DB_URL" -f supabase/migrations/0002_test_helpers.sql
```

Or use the Supabase CLI (`supabase db push`) or the Supabase SQL editor.

**Run the worker** (Phase 2+, heavy PDF parsing and the WCE loop):

```bash
cd worker
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

See `docs/05-build-plan.md` for the six-phase build plan and `docs/09-acceptance-criteria.md` for the definition of done.

## Status

Pre-launch. Watch the repo for releases.

## Contributing

Issues and pull requests welcome from anyone in the Alaska grant ecosystem. Substantive product changes that affect sovereignty posture go through the Indigenous Data Advisory Council review described in `docs/03-sovereignty.md`.

## License

Apache License 2.0. See [LICENSE](./LICENSE) and [NOTICE](./NOTICE).
