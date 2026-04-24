# 03 — Tribal Data Sovereignty

This document defines the contractual and architectural posture for the Tribal Sovereignty tier. It is not optional. Violations of this posture void the tier's value proposition and expose the founder to reputational and legal risk with tribal customers.

## Principles AuroraGrants embodies

### CARE Principles
Published by the Global Indigenous Data Alliance (GIDA), September 2019.
- **Collective Benefit.** Data ecosystems should enable Indigenous Peoples to derive benefit from the data.
- **Authority to Control.** Rights and interests of Indigenous Peoples must be recognized and their authority to control data respected.
- **Responsibility.** Those working with Indigenous data have a responsibility to share how those data are used.
- **Ethics.** Indigenous Peoples' rights and wellbeing should be the primary concern at all stages of the data life cycle.

### OCAP Principles
Ownership, Control, Access, Possession. First Nations Information Governance Centre.

### Executive Order 14112 principles
Increase accessibility, equity, flexibility, and utility of federal funding for tribes. The EO itself was rescinded in 2025; the underlying reporting burden it addressed persists, and the Treasury/HHS/Interior CX Pilot artifacts are the operative reference.

### 2 CFR 200 (2024 Revisions)
Effective October 1, 2024. Reduced several prior-approval thresholds. Compliance reports in AuroraGrants must align to 2 CFR 200.328 (monitoring) and 200.329 (reporting) field structures where applicable.

## Tier matrix

| Feature | Free | Solo | Team | Institutional | Sovereignty |
|---|---|---|---|---|---|
| Tenant isolation via RLS | ✓ | ✓ | ✓ | ✓ | ✓ |
| No-training pass-through | ✓ | ✓ | ✓ | ✓ | ✓ |
| US-region hosting | ✓ | ✓ | ✓ | ✓ | ✓ |
| Audit log viewable | | | ✓ | ✓ | ✓ |
| Audit log exportable | | | | ✓ | ✓ |
| Right to delete + export | ✓ | ✓ | ✓ | ✓ | ✓ |
| Anthropic ZDR routing | | | | optional | required |
| Per-tenant encryption key (BYOK) | | | | | ✓ |
| Offline CSV export and import | | | | | ✓ |
| Pre-signed Tribal Data Use Agreement | | | | | ✓ |
| Indigenous Data Advisory Council seat | | | | | ✓ |
| Dedicated Supabase project | | | | | ✓ |
| SFTP backup to tribal server | | | | | optional |
| Custom data residency region | | | | | ✓ |
| Signed Data Processing Addendum | | | | ✓ | ✓ |

## Architectural requirements for Sovereignty tier

### 1. Dedicated Supabase project per tenant
For Sovereignty tenants only. Shared Supabase for free through Institutional. The dedicated project has its own connection string, its own backups, and its own auth schema. Provisioned via Supabase Management API during onboarding.

### 2. ZDR routing to Anthropic
Set `tenants.zdr_enabled = true`. All Anthropic API calls for that tenant route through the ZDR-enabled organization. Header: `anthropic-version: 2023-06-01` plus the ZDR routing required by the Anthropic Commercial Terms addendum. Verify ZDR applies to every model version used (Sonnet 4.5, Opus 4.5, Haiku 4.5).

### 3. Bring-your-own-key (BYOK) encryption
Sovereignty tenant supplies a KMS-compatible key. All Storage bucket objects for that tenant are encrypted at rest with the customer-managed key. Implementation: Supabase Storage with customer-managed encryption via AWS KMS references, or Fly.io volumes with LUKS and a customer-held passphrase for the SFTP backup target.

### 4. Offline CSV export and import
Every tenant can download a complete export as a ZIP containing:
- `manifest.json` — schema version, export timestamp, tenant name
- `tenants.csv`, `users.csv`, `awards.csv`, `reports.csv`, `report_fields.csv`, `funders_referenced.csv`, `audit_log.csv`
- `/documents/` — all uploaded PDFs with original filenames
- `/chunks/` — parsed text per document as `{document_id}.json`

The import flow accepts the same ZIP. This must round-trip without loss.

Rationale: Treasury's SLFRF offline Excel template was built specifically because rural Alaska connectivity is unreliable. AuroraGrants must work the same way.

### 5. Pre-signed Tribal Data Use Agreement (TDUA)
Shipped as a PDF template. Customer signs. Stored in the tenant's `documents` table with kind = 'tdua'. Hash recorded in `audit_log`. The TDUA explicitly references CARE Principles, names an Indigenous Data Advisory Council member, and commits to 30-day deletion on request.

### 6. Indigenous Data Advisory Council
Five seats. At least one from a CARE-aligned institution. At least one from an ANCSA regional nonprofit. Paid stipend. Quarterly meetings. Publishes an annual report. Council reviews material product changes to sovereignty posture before release.

### 7. 30-day deletion
On `tenant.delete_requested`:
- Immediately revoke all access tokens.
- Export the tenant's data per the offline-export format above.
- Email the export to the tenant's designated contact.
- Schedule hard deletion in 30 days.
- On day 30, delete the tenant row (cascade deletes everything). Log to `audit_log` one final time before deletion, then copy the audit log to a non-tenant-scoped `deletion_receipts` table for our own records.

## Contracts to publish

1. **Terms of Service** with AI-content disclaimer.
2. **Privacy Policy** referencing Anthropic Commercial Terms pass-through.
3. **Data Processing Addendum** (Institutional and Sovereignty).
4. **Tribal Data Use Agreement** (Sovereignty only).
5. **AI-content disclosure footer** on every exported document: "Portions of this document were drafted with AI assistance. Reviewed and certified by [Signer Name]."

## Verification checklist (run before every Sovereignty tenant onboarding)

- [ ] Dedicated Supabase project created and accessible.
- [ ] ZDR routing confirmed via test API call that returns header confirming ZDR scope.
- [ ] BYOK key registered in AWS KMS.
- [ ] Offline export round-trips without loss on a seeded tenant.
- [ ] TDUA signed and hash logged.
- [ ] Tenant's designated contact confirms advisory council representation.
- [ ] 30-day deletion dry-run executes without error on a dummy tenant.
- [ ] Audit log export generates a valid CSV.

## Do not do

- Do not log tenant content (narratives, budgets, program data) in Sentry, Axiom, or any observability tool. Log only tenant_id, action, duration, status.
- Do not send tenant content to any model endpoint that is not confirmed ZDR for Sovereignty tenants.
- Do not train any model on tenant data, even anonymized, even "for improving the product," without written consent from every affected tenant.
- Do not use tenant data in marketing, case studies, or demos without explicit written consent and right to withdraw.
- Do not allow a non-Sovereignty tenant's data to land in a Sovereignty tenant's export by accident. Test cross-tenant isolation in every export.
