# AuroraGrants

Open-source, Alaska-specific AI grant-operations platform for nonprofits and tribal organizations.

Part of Arctic Intelligence (arcticintelligence.ai).

## What this is

AuroraGrants helps Alaska nonprofits and tribal organizations manage post-award federal and foundation grant compliance reporting. The v1 hero is post-award compliance: upload your award, we extract the reporting requirements, track deadlines, and draft each narrative field grounded in your own prior reports and program data, with inline citations, human review, and explicit sign-off before submission.

The whole product is free and open source under Apache-2.0. Host it yourself, fork it, change it.

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

```bash
pnpm install
pnpm dev
```

See `docs/05-build-plan.md` for the six-phase plan.

## Status

Pre-launch. Watch the repo for releases.

## Contributing

Issues and pull requests welcome from anyone in the Alaska grant ecosystem. Substantive product changes that affect sovereignty posture go through the Indigenous Data Advisory Council review described in `docs/03-sovereignty.md`.

## License

Apache License 2.0. See [LICENSE](./LICENSE) and [NOTICE](./NOTICE).
