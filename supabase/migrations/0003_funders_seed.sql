-- 0003_funders_seed.sql
-- Idempotent seed of all 30 Alaska funders from docs/04-funder-graph.md.
-- Run after 0001_initial.sql and 0002_test_helpers.sql.

begin;

-- ─── Foundation funders ───────────────────────────────────────────────────────

-- 1. Rasmuson Foundation — Tier 1
insert into funders (name, slug, type, scope, website, portal_type, description,
  eligibility, award_min_usd, award_max_usd, reporting_cadence, rubric)
values (
  'Rasmuson Foundation — Tier 1',
  'rasmuson-tier-1',
  'foundation', 'alaska',
  'https://rasmuson.org/find-funding/tier-1-grants/',
  'proprietary',
  'Small project grants for Alaska nonprofits, local governments, and federally recognized tribes.',
  '{"eligible_types": ["501c3", "local_government", "tribe"], "alaska_required": true, "min_years_operating": 1}'::jsonb,
  500, 35000, 'final_only',
  '[]'::jsonb
)
on conflict (slug) do update set
  name = excluded.name, type = excluded.type, scope = excluded.scope,
  website = excluded.website, portal_type = excluded.portal_type,
  description = excluded.description, eligibility = excluded.eligibility,
  award_min_usd = excluded.award_min_usd, award_max_usd = excluded.award_max_usd,
  reporting_cadence = excluded.reporting_cadence, updated_at = now();

-- 2. Rasmuson Foundation — Community Support
insert into funders (name, slug, type, scope, website, portal_type, description,
  eligibility, award_min_usd, award_max_usd, reporting_cadence)
values (
  'Rasmuson Foundation — Community Support',
  'rasmuson-community-support',
  'foundation', 'alaska',
  'https://rasmuson.org/find-funding/',
  'proprietary',
  'Mid-range capital and non-capital grants for established Alaska organizations.',
  '{"eligible_types": ["501c3", "local_government", "tribe"], "alaska_required": true}'::jsonb,
  35000, 250000, 'semiannual'
)
on conflict (slug) do update set
  name = excluded.name, type = excluded.type, scope = excluded.scope,
  website = excluded.website, portal_type = excluded.portal_type,
  description = excluded.description, eligibility = excluded.eligibility,
  award_min_usd = excluded.award_min_usd, award_max_usd = excluded.award_max_usd,
  reporting_cadence = excluded.reporting_cadence, updated_at = now();

-- 3. Rasmuson Foundation — Legacy
insert into funders (name, slug, type, scope, website, portal_type, description,
  eligibility, award_min_usd, reporting_cadence)
values (
  'Rasmuson Foundation — Legacy',
  'rasmuson-legacy',
  'foundation', 'alaska',
  'https://rasmuson.org/find-funding/legacy-grants/',
  'proprietary',
  'Large transformational grants via LOI-then-invited-proposal process.',
  '{"eligible_types": ["501c3", "local_government", "tribe"], "alaska_required": true, "loi_required": true}'::jsonb,
  250000, 'semiannual'
)
on conflict (slug) do update set
  name = excluded.name, type = excluded.type, scope = excluded.scope,
  website = excluded.website, portal_type = excluded.portal_type,
  description = excluded.description, eligibility = excluded.eligibility,
  award_min_usd = excluded.award_min_usd,
  reporting_cadence = excluded.reporting_cadence, updated_at = now();

-- 4. Rasmuson Foundation — Individual Artist Awards
insert into funders (name, slug, type, scope, website, portal_type, description,
  eligibility, award_min_usd, award_max_usd, reporting_cadence)
values (
  'Rasmuson Foundation — Individual Artist Awards',
  'rasmuson-iaa',
  'foundation', 'alaska',
  'https://rasmuson.org/find-funding/individual-artist-awards/',
  'proprietary',
  'Project, Fellowship, and Distinguished Artist grants for individual Alaska artists.',
  '{"eligible_types": ["individual_artist"], "alaska_required": true, "min_years_residence": 2}'::jsonb,
  10000, 50000, 'final_only'
)
on conflict (slug) do update set
  name = excluded.name, type = excluded.type, scope = excluded.scope,
  website = excluded.website, description = excluded.description,
  eligibility = excluded.eligibility,
  award_min_usd = excluded.award_min_usd, award_max_usd = excluded.award_max_usd,
  reporting_cadence = excluded.reporting_cadence, updated_at = now();

-- 5. Mat-Su Health Foundation — Healthy Impact
insert into funders (name, slug, type, scope, website, portal_type, description,
  eligibility, award_min_usd, reporting_cadence)
values (
  'Mat-Su Health Foundation — Healthy Impact',
  'mshf-healthy-impact',
  'foundation', 'alaska_region',
  'https://www.healthymatsu.org/how-we-fund/grant-programs',
  'proprietary',
  'Major health and wellness grants for organizations serving the Mat-Su Borough.',
  '{"eligible_types": ["501c3"], "service_area": "mat-su"}'::jsonb,
  25001, 'semiannual'
)
on conflict (slug) do update set
  name = excluded.name, type = excluded.type, scope = excluded.scope,
  website = excluded.website, description = excluded.description,
  eligibility = excluded.eligibility, award_min_usd = excluded.award_min_usd,
  reporting_cadence = excluded.reporting_cadence, updated_at = now();

-- 6. Mat-Su Health Foundation — Target Wellness
insert into funders (name, slug, type, scope, website, portal_type, description,
  eligibility, award_max_usd, reporting_cadence)
values (
  'Mat-Su Health Foundation — Target Wellness',
  'mshf-target-wellness',
  'foundation', 'alaska_region',
  'https://www.healthymatsu.org/how-we-fund/grant-programs',
  'proprietary',
  'Small wellness grants for Mat-Su-serving nonprofits.',
  '{"eligible_types": ["501c3"], "service_area": "mat-su"}'::jsonb,
  25000, 'final_only'
)
on conflict (slug) do update set
  name = excluded.name, type = excluded.type, scope = excluded.scope,
  website = excluded.website, description = excluded.description,
  eligibility = excluded.eligibility, award_max_usd = excluded.award_max_usd,
  reporting_cadence = excluded.reporting_cadence, updated_at = now();

-- 7. Alaska Community Foundation — Competitive Funds
insert into funders (name, slug, type, scope, website, portal_url, portal_type, description,
  eligibility, award_min_usd, award_max_usd, reporting_cadence)
values (
  'Alaska Community Foundation — Competitive Funds',
  'acf-competitive',
  'foundation', 'alaska',
  'https://alaskacf.org/',
  'https://alaskacf.org/grants/',
  'proprietary',
  'Community-focused competitive grants for Alaska nonprofits.',
  '{"eligible_types": ["501c3"], "alaska_required": true}'::jsonb,
  2000, 100000, 'annual'
)
on conflict (slug) do update set
  name = excluded.name, type = excluded.type, scope = excluded.scope,
  website = excluded.website, portal_url = excluded.portal_url,
  description = excluded.description, eligibility = excluded.eligibility,
  award_min_usd = excluded.award_min_usd, award_max_usd = excluded.award_max_usd,
  reporting_cadence = excluded.reporting_cadence, updated_at = now();

-- 8. CIRI Foundation
insert into funders (name, slug, type, scope, website, description,
  eligibility, reporting_cadence)
values (
  'CIRI Foundation',
  'ciri-foundation',
  'foundation', 'alaska',
  'https://thecirifoundation.org/',
  'Scholarships and capacity grants for Alaska Native people with CIRI ties.',
  '{"eligible_types": ["individual", "organization"], "alaska_native_required": true, "ciri_connection_required": true}'::jsonb,
  'final_only'
)
on conflict (slug) do update set
  name = excluded.name, type = excluded.type, scope = excluded.scope,
  website = excluded.website, description = excluded.description,
  eligibility = excluded.eligibility, reporting_cadence = excluded.reporting_cadence,
  updated_at = now();

-- 9. Alaska Children's Trust
insert into funders (name, slug, type, scope, website, description,
  eligibility, award_min_usd, award_max_usd, reporting_cadence)
values (
  'Alaska Children''s Trust',
  'alaska-childrens-trust',
  'foundation', 'alaska',
  'https://alaskachildrenstrust.org/',
  'Prevention grants for programs that support child abuse and neglect prevention in Alaska.',
  '{"eligible_types": ["501c3"], "alaska_required": true}'::jsonb,
  5000, 50000, 'semiannual'
)
on conflict (slug) do update set
  name = excluded.name, type = excluded.type, scope = excluded.scope,
  website = excluded.website, description = excluded.description,
  eligibility = excluded.eligibility,
  award_min_usd = excluded.award_min_usd, award_max_usd = excluded.award_max_usd,
  reporting_cadence = excluded.reporting_cadence, updated_at = now();

-- 10. Alaska Mental Health Trust Authority
insert into funders (name, slug, type, scope, website, portal_type, description,
  eligibility, reporting_cadence)
values (
  'Alaska Mental Health Trust Authority',
  'amhta',
  'state', 'alaska',
  'https://alaskamentalhealthtrust.org/',
  'smartsimple',
  'Funding for programs serving Alaska Mental Health Trust beneficiaries.',
  '{"eligible_types": ["501c3", "government", "tribe"], "alaska_required": true, "beneficiary_required": true}'::jsonb,
  'quarterly'
)
on conflict (slug) do update set
  name = excluded.name, type = excluded.type, scope = excluded.scope,
  website = excluded.website, portal_type = excluded.portal_type,
  description = excluded.description, eligibility = excluded.eligibility,
  reporting_cadence = excluded.reporting_cadence, updated_at = now();

-- 11. GCI Community Giving
insert into funders (name, slug, type, scope, website, portal_type, description,
  eligibility, award_min_usd, award_max_usd, reporting_cadence)
values (
  'GCI Community Giving',
  'gci-community',
  'corporate', 'alaska',
  'https://www.gci.com/community/',
  'email',
  'Corporate giving and suicide prevention fund grants from GCI.',
  '{"eligible_types": ["501c3"], "alaska_required": true}'::jsonb,
  1000, 50000, 'final_only'
)
on conflict (slug) do update set
  name = excluded.name, type = excluded.type, scope = excluded.scope,
  website = excluded.website, portal_type = excluded.portal_type,
  description = excluded.description, eligibility = excluded.eligibility,
  award_min_usd = excluded.award_min_usd, award_max_usd = excluded.award_max_usd,
  reporting_cadence = excluded.reporting_cadence, updated_at = now();

-- 12. Alaska Airlines Corporate Giving
insert into funders (name, slug, type, scope, website, portal_type, description,
  eligibility, award_min_usd, award_max_usd, reporting_cadence)
values (
  'Alaska Airlines Corporate Giving',
  'alaska-airlines-giving',
  'corporate', 'regional',
  'https://www.alaskaair.com/content/about-alaska/community/sponsorships-donations',
  'submittable',
  'Corporate sponsorship and charitable giving for organizations in Alaska Airlines communities.',
  '{"eligible_types": ["501c3"]}'::jsonb,
  1000, 25000, 'final_only'
)
on conflict (slug) do update set
  name = excluded.name, type = excluded.type, scope = excluded.scope,
  website = excluded.website, portal_type = excluded.portal_type,
  description = excluded.description, eligibility = excluded.eligibility,
  award_min_usd = excluded.award_min_usd, award_max_usd = excluded.award_max_usd,
  reporting_cadence = excluded.reporting_cadence, updated_at = now();

-- 13. ConocoPhillips Alaska Community Giving
insert into funders (name, slug, type, scope, website, portal_type, description,
  eligibility, reporting_cadence)
values (
  'ConocoPhillips Alaska Community Giving',
  'conocophillips-alaska-giving',
  'corporate', 'alaska',
  'https://www.conocophillips.com/community/',
  'pdf',
  'Corporate philanthropy for Alaska communities near ConocoPhillips operations.',
  '{"eligible_types": ["501c3"], "alaska_required": true}'::jsonb,
  'annual'
)
on conflict (slug) do update set
  name = excluded.name, type = excluded.type, scope = excluded.scope,
  website = excluded.website, portal_type = excluded.portal_type,
  description = excluded.description, eligibility = excluded.eligibility,
  reporting_cadence = excluded.reporting_cadence, updated_at = now();

-- 14. Hilcorp Alaska Community Giving
insert into funders (name, slug, type, scope, website, portal_type, description,
  eligibility, reporting_cadence)
values (
  'Hilcorp Alaska Community Giving',
  'hilcorp-alaska-giving',
  'corporate', 'alaska',
  'https://www.hilcorp.com/',
  'email',
  'Community giving for organizations in areas where Hilcorp Alaska operates.',
  '{"eligible_types": ["501c3"], "alaska_required": true}'::jsonb,
  'final_only'
)
on conflict (slug) do update set
  name = excluded.name, type = excluded.type, scope = excluded.scope,
  website = excluded.website, portal_type = excluded.portal_type,
  description = excluded.description, eligibility = excluded.eligibility,
  reporting_cadence = excluded.reporting_cadence, updated_at = now();

-- ─── State funders ────────────────────────────────────────────────────────────

-- 15. AHFC GOAL
insert into funders (name, slug, type, scope, website, portal_type, description,
  eligibility, award_min_usd, award_max_usd, reporting_cadence)
values (
  'AHFC — General Obligation and Leveraged Loan (GOAL)',
  'ahfc-goal',
  'state', 'alaska',
  'https://www.ahfc.us/professionals/rental-housing-programs/goal-program',
  'proprietary',
  'Affordable housing development grants and loans for Alaska developers and nonprofits.',
  '{"eligible_types": ["developer", "nonprofit", "tribal_housing_authority"], "alaska_required": true}'::jsonb,
  500000, 10000000, 'annual'
)
on conflict (slug) do update set
  name = excluded.name, type = excluded.type, scope = excluded.scope,
  website = excluded.website, portal_type = excluded.portal_type,
  description = excluded.description, eligibility = excluded.eligibility,
  award_min_usd = excluded.award_min_usd, award_max_usd = excluded.award_max_usd,
  reporting_cadence = excluded.reporting_cadence, updated_at = now();

-- 16. AHFC HOME
insert into funders (name, slug, type, scope, website, portal_type, description,
  eligibility, reporting_cadence)
values (
  'AHFC — HOME Investment Partnerships',
  'ahfc-home',
  'state', 'alaska',
  'https://www.ahfc.us/professionals/rental-housing-programs/home-program',
  'proprietary',
  'HUD HOME funds administered by AHFC for affordable housing in Alaska.',
  '{"eligible_types": ["nonprofit", "local_government", "tribal_housing_authority"], "alaska_required": true}'::jsonb,
  'annual'
)
on conflict (slug) do update set
  name = excluded.name, type = excluded.type, scope = excluded.scope,
  website = excluded.website, description = excluded.description,
  eligibility = excluded.eligibility,
  reporting_cadence = excluded.reporting_cadence, updated_at = now();

-- 17. AHFC LIHTC
insert into funders (name, slug, type, scope, website, portal_type, description,
  eligibility, reporting_cadence)
values (
  'AHFC — Low-Income Housing Tax Credits (LIHTC)',
  'ahfc-lihtc',
  'state', 'alaska',
  'https://www.ahfc.us/professionals/rental-housing-programs/lihtc',
  'proprietary',
  'Federal tax credits allocated by AHFC for affordable housing development.',
  '{"eligible_types": ["developer", "nonprofit"], "alaska_required": true}'::jsonb,
  'annual'
)
on conflict (slug) do update set
  name = excluded.name, type = excluded.type, scope = excluded.scope,
  website = excluded.website, description = excluded.description,
  eligibility = excluded.eligibility,
  reporting_cadence = excluded.reporting_cadence, updated_at = now();

-- 18. State of Alaska DHSS Competitive
insert into funders (name, slug, type, scope, website, portal_type, description,
  eligibility, reporting_cadence)
values (
  'State of Alaska DHSS Competitive Grants',
  'ak-dhss',
  'state', 'alaska',
  'https://dhss.alaska.gov/',
  'smartsimple',
  'Competitive grants from the Alaska Department of Health and Social Services.',
  '{"eligible_types": ["501c3", "government", "tribe"], "alaska_required": true}'::jsonb,
  'quarterly'
)
on conflict (slug) do update set
  name = excluded.name, type = excluded.type, scope = excluded.scope,
  website = excluded.website, portal_type = excluded.portal_type,
  description = excluded.description, eligibility = excluded.eligibility,
  reporting_cadence = excluded.reporting_cadence, updated_at = now();

-- ─── Federal funders ─────────────────────────────────────────────────────────

-- 19. Denali Commission
insert into funders (name, slug, type, scope, website, portal_url, portal_type, description,
  eligibility, award_min_usd, award_max_usd, reporting_cadence)
values (
  'Denali Commission',
  'denali-commission',
  'federal', 'alaska',
  'https://denali.gov/',
  'https://denali.gov/grants/',
  'grants_gov',
  'Federal infrastructure, energy, and workforce grants for rural Alaska.',
  '{"eligible_types": ["tribe", "local_government", "nonprofit"], "alaska_required": true}'::jsonb,
  25000, 5000000, 'semiannual'
)
on conflict (slug) do update set
  name = excluded.name, type = excluded.type, scope = excluded.scope,
  website = excluded.website, portal_url = excluded.portal_url,
  portal_type = excluded.portal_type, description = excluded.description,
  eligibility = excluded.eligibility,
  award_min_usd = excluded.award_min_usd, award_max_usd = excluded.award_max_usd,
  reporting_cadence = excluded.reporting_cadence, updated_at = now();

-- 20. HUD ICDBG
insert into funders (name, slug, type, scope, website, portal_type, description,
  eligibility, award_max_usd, reporting_cadence)
values (
  'HUD Indian Community Development Block Grant (ICDBG)',
  'hud-icdbg',
  'federal', 'national',
  'https://www.hud.gov/program_offices/public_indian_housing/ih/grants/icdbg',
  'grants_gov',
  'Block grants for housing and community development for federally recognized tribes and TDHEs.',
  '{"eligible_types": ["tribe", "tdhe"], "federally_recognized_required": true}'::jsonb,
  5000000, 'quarterly'
)
on conflict (slug) do update set
  name = excluded.name, type = excluded.type, scope = excluded.scope,
  website = excluded.website, portal_type = excluded.portal_type,
  description = excluded.description, eligibility = excluded.eligibility,
  award_max_usd = excluded.award_max_usd,
  reporting_cadence = excluded.reporting_cadence, updated_at = now();

-- 21. Treasury SLFRF
insert into funders (name, slug, type, scope, website, portal_type, description,
  eligibility, reporting_cadence)
values (
  'Treasury State and Local Fiscal Recovery Funds (SLFRF)',
  'treasury-slfrf',
  'federal', 'national',
  'https://home.treasury.gov/policy-issues/coronavirus/assistance-for-state-local-and-tribal-governments/state-and-local-fiscal-recovery-fund',
  'proprietary',
  'Formula-allocated COVID recovery funds for tribal governments.',
  '{"eligible_types": ["tribe"], "federally_recognized_required": true}'::jsonb,
  'quarterly'
)
on conflict (slug) do update set
  name = excluded.name, type = excluded.type, scope = excluded.scope,
  website = excluded.website, portal_type = excluded.portal_type,
  description = excluded.description, eligibility = excluded.eligibility,
  reporting_cadence = excluded.reporting_cadence, updated_at = now();

-- 22. IHS Behavioral Health Aide
insert into funders (name, slug, type, scope, website, portal_type, description,
  eligibility, reporting_cadence)
values (
  'Indian Health Service — Behavioral Health Aide Program',
  'ihs-bh-aide',
  'federal', 'national',
  'https://www.ihs.gov/behavioralhealth/',
  'proprietary',
  'IHS grants to support tribal behavioral health aide programs.',
  '{"eligible_types": ["tribe", "tribal_organization"], "ihs_service_area_required": true}'::jsonb,
  'annual'
)
on conflict (slug) do update set
  name = excluded.name, type = excluded.type, scope = excluded.scope,
  website = excluded.website, portal_type = excluded.portal_type,
  description = excluded.description, eligibility = excluded.eligibility,
  reporting_cadence = excluded.reporting_cadence, updated_at = now();

-- 23. IHS Special Diabetes Program for Indians
insert into funders (name, slug, type, scope, website, portal_type, description,
  eligibility, reporting_cadence)
values (
  'IHS Special Diabetes Program for Indians (SDPI)',
  'ihs-sdpi',
  'federal', 'national',
  'https://www.ihs.gov/sdpi/',
  'proprietary',
  'Diabetes prevention and treatment grants for tribal programs.',
  '{"eligible_types": ["tribe", "tribal_organization"], "ihs_service_area_required": true}'::jsonb,
  'annual'
)
on conflict (slug) do update set
  name = excluded.name, type = excluded.type, scope = excluded.scope,
  website = excluded.website, description = excluded.description,
  eligibility = excluded.eligibility,
  reporting_cadence = excluded.reporting_cadence, updated_at = now();

-- 24. IHS Community Health Representative
insert into funders (name, slug, type, scope, website, portal_type, description,
  eligibility, reporting_cadence)
values (
  'IHS Community Health Representative Program',
  'ihs-chr',
  'federal', 'national',
  'https://www.ihs.gov/chr/',
  'proprietary',
  'Funding for tribal community health representative programs.',
  '{"eligible_types": ["tribe", "tribal_organization"], "ihs_service_area_required": true}'::jsonb,
  'annual'
)
on conflict (slug) do update set
  name = excluded.name, type = excluded.type, scope = excluded.scope,
  website = excluded.website, description = excluded.description,
  eligibility = excluded.eligibility,
  reporting_cadence = excluded.reporting_cadence, updated_at = now();

-- 25. EPA Tribal Performance Partnership Grants
insert into funders (name, slug, type, scope, website, portal_url, portal_type, description,
  eligibility, reporting_cadence)
values (
  'EPA Tribal Performance Partnership Grants (PPG)',
  'epa-ppg',
  'federal', 'national',
  'https://www.epa.gov/tribal/',
  'https://www.epa.gov/tribal/epa-tribal-grants',
  'grants_gov',
  'Consolidated EPA environmental grants for tribal governments combining multiple programs.',
  '{"eligible_types": ["tribe"], "federally_recognized_required": true}'::jsonb,
  'annual'
)
on conflict (slug) do update set
  name = excluded.name, type = excluded.type, scope = excluded.scope,
  website = excluded.website, portal_url = excluded.portal_url,
  portal_type = excluded.portal_type, description = excluded.description,
  eligibility = excluded.eligibility,
  reporting_cadence = excluded.reporting_cadence, updated_at = now();

-- 26. BIA Tribal Energy Development Capacity
insert into funders (name, slug, type, scope, website, portal_type, description,
  eligibility, award_min_usd, award_max_usd, reporting_cadence)
values (
  'BIA Tribal Energy Development Capacity (TEDC)',
  'bia-tedc',
  'federal', 'national',
  'https://www.bia.gov/service/grants/tedc',
  'grants_gov',
  'Capacity-building grants for tribal energy development programs.',
  '{"eligible_types": ["tribe"], "federally_recognized_required": true}'::jsonb,
  50000, 500000, 'semiannual'
)
on conflict (slug) do update set
  name = excluded.name, type = excluded.type, scope = excluded.scope,
  website = excluded.website, portal_type = excluded.portal_type,
  description = excluded.description, eligibility = excluded.eligibility,
  award_min_usd = excluded.award_min_usd, award_max_usd = excluded.award_max_usd,
  reporting_cadence = excluded.reporting_cadence, updated_at = now();

-- 27. BIA Native American Business Development Institute
insert into funders (name, slug, type, scope, website, portal_type, description,
  eligibility, reporting_cadence)
values (
  'BIA Native American Business Development Institute (NABDI)',
  'bia-nabdi',
  'federal', 'national',
  'https://www.bia.gov/service/grants/nabdi',
  'grants_gov',
  'Feasibility study funding for tribal economic development projects.',
  '{"eligible_types": ["tribe", "tribal_enterprise"], "federally_recognized_required": true}'::jsonb,
  'annual'
)
on conflict (slug) do update set
  name = excluded.name, type = excluded.type, scope = excluded.scope,
  website = excluded.website, portal_type = excluded.portal_type,
  description = excluded.description, eligibility = excluded.eligibility,
  reporting_cadence = excluded.reporting_cadence, updated_at = now();

-- 28. NOAA Tribal Grants
insert into funders (name, slug, type, scope, website, portal_type, description,
  eligibility, reporting_cadence)
values (
  'NOAA Tribal Grants',
  'noaa-tribal',
  'federal', 'national',
  'https://www.fisheries.noaa.gov/contact/office-tribal-relations',
  'grants_gov',
  'NOAA grants for tribal fisheries, habitat, and climate programs.',
  '{"eligible_types": ["tribe"], "federally_recognized_required": true}'::jsonb,
  'annual'
)
on conflict (slug) do update set
  name = excluded.name, type = excluded.type, scope = excluded.scope,
  website = excluded.website, portal_type = excluded.portal_type,
  description = excluded.description, eligibility = excluded.eligibility,
  reporting_cadence = excluded.reporting_cadence, updated_at = now();

-- 29. HHS Administration for Native Americans
insert into funders (name, slug, type, scope, website, portal_url, portal_type, description,
  eligibility, reporting_cadence)
values (
  'HHS Administration for Native Americans (ANA)',
  'hhs-ana',
  'federal', 'national',
  'https://www.acf.hhs.gov/ana',
  'https://www.grants.gov/',
  'grants_gov',
  'Social and economic development, language preservation, and environmental health grants for Native Americans.',
  '{"eligible_types": ["tribe", "tribal_organization", "alaska_native_nonprofit"], "native_american_required": true}'::jsonb,
  'semiannual'
)
on conflict (slug) do update set
  name = excluded.name, type = excluded.type, scope = excluded.scope,
  website = excluded.website, portal_url = excluded.portal_url,
  portal_type = excluded.portal_type, description = excluded.description,
  eligibility = excluded.eligibility,
  reporting_cadence = excluded.reporting_cadence, updated_at = now();

-- 30. USDA Rural Development Tribal Set-asides
insert into funders (name, slug, type, scope, website, portal_type, description,
  eligibility, reporting_cadence)
values (
  'USDA Rural Development (Tribal Set-asides)',
  'usda-rural-dev-tribal',
  'federal', 'national',
  'https://www.rd.usda.gov/programs-services/all-programs/tribal-programs',
  'grants_gov',
  'USDA rural utility, housing, business, and community facility programs with tribal set-asides.',
  '{"eligible_types": ["tribe", "tribal_organization", "nonprofit"], "rural_required": true}'::jsonb,
  'annual'
)
on conflict (slug) do update set
  name = excluded.name, type = excluded.type, scope = excluded.scope,
  website = excluded.website, portal_type = excluded.portal_type,
  description = excluded.description, eligibility = excluded.eligibility,
  reporting_cadence = excluded.reporting_cadence, updated_at = now();

commit;
