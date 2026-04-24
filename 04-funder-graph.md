# 04 — Alaska Funder Graph

This is the seed data for the `funders` table. Claude Code should generate a migration that inserts these 30 funders with the rubric, eligibility, and reporting-cadence structure below. Source URLs are provided so the Phase 2 parser can ingest each funder's guidelines document where available.

## Foundation funders

### 1. Rasmuson Foundation — Tier 1
- Slug: `rasmuson-tier-1`
- Type: foundation, Alaska scope
- Award range: $500–$35,000 (most $5–20k)
- Portal: proprietary, rolling
- Reporting: final only
- Eligibility: AK 501(c)(3) ≥1yr, local government, federally recognized tribe
- Rubric (abbreviated):
  - Organizational capacity (0.25)
  - Project feasibility (0.25)
  - Community impact (0.25)
  - Budget appropriateness (0.25)
- Source: https://rasmuson.org/find-funding/tier-1-grants/

### 2. Rasmuson Foundation — Community Support
- Slug: `rasmuson-community-support`
- Award range: $35,000–$250,000
- Portal: proprietary, quarterly (capital) and semi-annual (non-capital)
- Reporting: progress + final

### 3. Rasmuson Foundation — Legacy
- Slug: `rasmuson-legacy`
- Award range: $250,000+
- Process: LOI then invited proposal
- Reporting: progress + final + financial
- Rubric: community impact, organizational capacity, financial management, community partnerships, project feasibility and sustainability, alignment with community and state needs
- Source: https://rasmuson.org/find-funding/legacy-grants/

### 4. Rasmuson Foundation — Individual Artist Awards
- Slug: `rasmuson-iaa`
- Award range: $10,000 (Project), $25,000 (Fellowship), $50,000 (Distinguished Artist)
- Eligibility: individual artists, 2+ years AK residence

### 5. Mat-Su Health Foundation — Healthy Impact
- Slug: `mshf-healthy-impact`
- Award range: >$25,000
- Portal: proprietary
- Reporting: progress + final
- Eligibility: Mat-Su-serving 501(c)(3)
- Source: https://www.healthymatsu.org/how-we-fund/grant-programs

### 6. Mat-Su Health Foundation — Target Wellness
- Slug: `mshf-target-wellness`
- Award range: ≤$25,000
- Reporting: final

### 7. Alaska Community Foundation — Competitive Funds
- Slug: `acf-competitive`
- Award range: $2,000–$100,000
- Portal: ACF proprietary
- Source: https://alaskacf.org/grants/

### 8. CIRI Foundation
- Slug: `ciri-foundation`
- Eligibility: Alaska Native descent or CIRI shareholders
- Programs: scholarships, capacity grants

### 9. Alaska Children's Trust
- Slug: `alaska-childrens-trust`
- Award range: $5,000–$50,000

### 10. Alaska Mental Health Trust Authority
- Slug: `amhta`
- Portal: AK GEMS
- Reporting: quarterly

### 11. GCI Suicide Prevention Fund + community giving
- Slug: `gci-community`
- Award range: $1,000–$50,000
- Portal: email or PDF form

### 12. Alaska Airlines corporate giving
- Slug: `alaska-airlines-giving`
- Portal: web form
- Award range: $1,000–$25,000

### 13. ConocoPhillips Alaska community giving
- Slug: `conocophillips-alaska-giving`
- Portal: PDF

### 14. Hilcorp Alaska community giving
- Slug: `hilcorp-alaska-giving`
- Portal: email

## State funders

### 15. AHFC GOAL
- Slug: `ahfc-goal`
- Type: state
- Award range: $500,000–$10M+
- Portal: AHFC proprietary
- Reporting: annual compliance per QAP
- Eligibility: developers and nonprofits

### 16. AHFC HOME
- Slug: `ahfc-home`

### 17. AHFC LIHTC
- Slug: `ahfc-lihtc`

### 18. State of Alaska DHSS competitive
- Slug: `ak-dhss`
- Portal: AK GEMS
- Reporting: quarterly

## Federal funders

### 19. Denali Commission
- Slug: `denali-commission`
- Award range: $25,000–$5M+
- Portal: SF-424 via denali.gov and Denali Project Database System 2.0
- Reporting: SF-425 + progress reports
- Programs: infrastructure, energy, workforce
- Eligibility: tribes, local government, nonprofits
- Source: https://denali.gov/grants/

### 20. Indian Community Development Block Grant (ICDBG)
- Slug: `hud-icdbg`
- Award range: up to $5M imminent-threat
- Portal: Grants.gov + HUD
- Reporting: quarterly
- Eligibility: federally recognized tribes and TDHEs

### 21. State and Local Fiscal Recovery Funds (SLFRF)
- Slug: `treasury-slfrf`
- Award: formula-allocated to tribes
- Portal: Treasury portal + offline Excel template designed for AK tribes
- Reporting: quarterly and annual
- Eligibility: tribal government

### 22. Indian Health Service (IHS) Behavioral Health Aide
- Slug: `ihs-bh-aide`
- Portal: IHS portal
- Reporting: post-CX-pilot reduced from 8.9 to 3.2 hours

### 23. IHS Special Diabetes Program for Indians (SDPI)
- Slug: `ihs-sdpi`

### 24. IHS Community Health Representative
- Slug: `ihs-chr`

### 25. EPA Tribal Performance Partnership Grants (PPG)
- Slug: `epa-ppg`
- Portal: EPA Grants
- Reporting: annual
- Note: combines multiple grants into a single budget

### 26. BIA Tribal Energy Development Capacity (TEDC)
- Slug: `bia-tedc`
- Award range: $50,000–$500,000

### 27. BIA Native American Business Development Institute (NABDI)
- Slug: `bia-nabdi`

### 28. NOAA Tribal
- Slug: `noaa-tribal`

### 29. Administration for Native Americans (ANA)
- Slug: `hhs-ana`
- Portal: Grants.gov

### 30. USDA Rural Development (tribal set-asides)
- Slug: `usda-rural-dev-tribal`

## Schema for rubric field (reminder)

```json
{
  "id": "community_impact",
  "label": "Community impact",
  "weight": 0.25,
  "description": "Describe measurable impact on Alaska communities that the project will create.",
  "scoring": [
    {"score": 0, "desc": "Impact is vague or not measurable."},
    {"score": 1, "desc": "Impact is specific but affects a small population."},
    {"score": 2, "desc": "Impact is specific, measurable, and affects a significant Alaska population with a clear theory of change."}
  ],
  "common_failures": [
    "Boilerplate language without quantified beneficiaries",
    "Missing baseline data",
    "No post-project measurement plan"
  ]
}
```

## Seeding tasks

1. Create `supabase/seed/funders.sql` with INSERT statements for all 30 funders above, scoped by slug with `ON CONFLICT (slug) DO UPDATE`.
2. For each funder, download the most recent guidelines PDF where publicly available and store it under `supabase/seed/funder_docs/{slug}.pdf`.
3. Run the Phase 2 ingestion pipeline against these PDFs to populate chunks and embeddings tagged with `funder_id` (not `tenant_id`; these are shared reference docs).
4. Manually curate rubrics for the top 10 funders (Rasmuson Legacy, Rasmuson Community Support, Rasmuson Tier 1, MSHF Healthy Impact, MSHF Target Wellness, ACF Competitive, AHFC GOAL, Denali Commission, ICDBG, IHS BH Aide). The remaining 20 can start with generic rubrics and be refined in month 2.

## Do not do

- Do not auto-populate rubrics from AI extraction alone. Manual curation first, then AI refinement with human review.
- Do not publish funder profiles on a public page without the funder's awareness. Free tier Deadline Radar can show deadlines but not rubrics or internal notes.
- Do not scrape funder portals at rates that violate their robots.txt or terms of service. Respect rate limits. Prefer the public guidelines PDF over portal scraping.
