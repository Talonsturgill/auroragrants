# 00 — Mission

## The problem

Federal tribal grant reporting costs Alaska tribes and tribal organizations roughly 8.9 hours per IHS report before redesign, per Treasury's July 2024 CX Pilot. GAO-25-107674 documents that "managing administrative burdens such as application and reporting requirements can strain Tribes' staffing capacity" and identifies reporting as a structural barrier to federal assistance. Alaska has 229 federally recognized tribes, 12 ANCSA regional nonprofits, and over 200 nonprofits in the Foraker Group ecosystem. Congress approved $32.6 billion in FY 2024 for tribal-benefit programs. The addressable reporting-labor burden in Alaska alone is in the eight figures.

Existing tools (Instrumentl, Grantable, Grant Assistant) are discovery-first or drafting-first, US-wide, cloud-only, closed source, and have no tribal data sovereignty posture. None has Alaska funder rubric depth. None has offline-compatible reporting. None has a CARE-aligned contracting framework. This is a structural gap, not a feature gap, and it is not going to be closed by a commercial vendor whose unit economics require national scale.

## The product

AuroraGrants is post-award compliance reporting first, then proposal drafting, then funder discovery. Every AI output is grounded in the user's own prior documents, cited inline, and presented as a draft that requires human sign-off before export. The **Sovereignty deployment** adds per-tenant encryption, Anthropic ZDR routing, pre-signed Tribal Data Use Agreements, offline CSV export and import, and an Indigenous Data Advisory Council seat. It is free to any tribal organization that asks.

## Why open source

A tool that polices the public grant-reporting system should be auditable by the public. Every funder rubric, prompt, eval check, and RLS policy lives in the repo under Apache-2.0. Nonprofits and tribes can self-host inside their own network when sovereignty requirements demand it. Forks are welcome. The upstream is free forever.

## The commitments

1. Alaska-curated funder rubrics, maintained in the open under community governance.
2. CARE-aligned sovereignty architecture that cloud-only incumbents cannot retrofit quickly.
3. Partnership-of-record relationships with The Foraker Group and Tanana Chiefs Conference Planning and Development.
4. Offline mode compatible with Treasury's SLFRF offline Excel template for rural Alaska.
5. Native-Alaskan founder presence at Foraker Leadership Summit, AFN Convention, and BIA Alaska Tribal Providers Conference.
6. Pre-signed Tribal Data Use Agreements with any tribe that adopts the Sovereignty deployment posture.

## The timeline

- v1 hero: Compliance reporting and Deadline Radar. Ships this session.
- v1.1: Proposal drafting with Writer-Critic-Editor loop. Month 3.
- v1.2: Funder discovery with the Alaska Funder Rubric Graph. Month 6.
- v2: AuroraBoard (year 2), AuroraProcurement (year 2-3), AuroraPolicy (year 3).

## The success metric

Ten Alaska organizations using AuroraGrants in production within 12 months, at least two tribal governments on Sovereignty deployments, with documented greater than 50 percent reporting-hours reduction on at least five completed real-world reports. The project is funded through grants, services, and contributions from the Arctic Intelligence foundation layer, not software licensing.
