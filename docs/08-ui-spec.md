# 08 — UI Spec

Every page is a Server Component except where interactivity requires Client. Every interactive element uses shadcn/ui. No custom CSS outside Tailwind utility classes.

## Marketing site (`/`)

- Hero. Headline: "Grant compliance built for Alaska." Subhead: "AuroraGrants helps Alaska nonprofits and tribal organizations draft, review, and submit grant reports in a fraction of the time, with human review and tribal data sovereignty built in. Free and open source under Apache-2.0."
- CTA: "Get notified when we launch" and "View on GitHub."
- Problem. Two paragraphs on the reporting burden, citing Treasury and GAO.
- Who it's for. Three cards: Anchorage 501(c)(3), ANCSA regional nonprofit, Tribal government.
- Open source. Four cards explaining the Apache-2.0 license, free-for-every-organization commitment, community roadmap, and Sovereignty-as-posture (not a tier).
- Sovereignty. One section explaining CARE, ZDR, advisory council, offline mode.
- Founder note. Short paragraph signed by the founder.
- Notify-me form. Email + org type + interest (hosted, self-host, sovereignty).
- Footer. Contact, privacy, terms, mission, GitHub.

## App shell (`/app`)

Sidebar:
- Dashboard
- Deadlines
- Opportunities
- Awards
- Reports
- Documents
- Settings (org info, users, data sovereignty, audit log, export)

Top bar: org switcher (Clerk), user menu, help.

"Sovereignty deployment" badge in sidebar footer when the tenant is on a Sovereignty deployment. Otherwise no tier chrome.

## Dashboard (`/app`)

Four cards across:
1. Reports due in the next 14 days (count + link).
2. Draft completion (count of fields approved vs total across upcoming reports).
3. Token budget used this month (with bar).
4. New opportunities this week.

Below: recent activity feed (drafts generated, fields approved, reports submitted).

## Deadlines (`/app/deadlines`)

Table of deadlines, sorted by `due_at`. Columns: funder, program, type (opportunity/report), due_at, status, assignee.

Filters: funder, time window, type, acknowledged/not.

Row action: "Acknowledge" and "Open in Report/Opportunity."

## Opportunities (`/app/opportunities`)

Table of tracked opportunities. Columns: funder, title, deadline, award range, status.

Row click: opportunity detail page showing extracted requirements, source NOFO, linked draft if any.

## Awards (`/app/awards`)

Table of awards. Columns: funder, program, amount, period, award number, next report due.

Detail page: metadata, linked reports.

## Reports (`/app/reports`)

Table of reports. Columns: funder, report title, period, due_at, status, approver.

Row click: report detail page.

## Report detail (`/app/reports/[id]`)

Three-pane layout:
- Left pane (240px): list of `report_fields` with per-field status chip (not started, drafting, ready for review, approved).
- Center pane (flex 1): the selected field.
  - Field header: label, word count counter (current / max), status chip.
  - Editor: rich text (TipTap) with inline citation tokens rendered as `[1]`, `[2]` chips. Hover shows the cited chunk and source document.
  - Persistent banner: "Draft — review before submission." Red border on banner.
  - Buttons: "Generate draft," "Regenerate," "Revert to last approved," "Mark field approved."
  - "Mark field approved" shows a confirmation dialog with the attestation text: "I am the authorized reviewer for this report. I have read this content. I certify that it is accurate to the best of my knowledge."
- Right pane (360px): critic feedback (rubric scores, fixes), eval scorecard (factuality, rubric, readability, word count, hallucinations), source citations expandable list.

Report-level actions at the top:
- "Prepare export" (requires all required fields approved). Generates PDF + DOCX + clipboard-ready plain text.
- "Submit." Records `submitted_at`, moves status to submitted.

## Documents (`/app/documents`)

Drag-drop upload. Table of documents with kind, page count, parse status, upload date.

Detail page: document metadata, parse output preview, chunks preview with citation IDs.

## Settings — Org (`/app/settings/org`)

Org name, EIN, primary contact, phone, address, org type.

## Settings — Users (`/app/settings/users`)

Table of users with role. Invite new user. Remove user.

## Settings — Data Sovereignty (`/app/settings/sovereignty`)

Available to every tenant.

- LLM provider (Anthropic default / Anthropic ZDR / OpenAI / Google).
- Data residency region.
- ZDR status (green badge if active).
- BYOK key status (Sovereignty deployments only).
- TDUA signed status (Sovereignty deployments only).
- Advisory council contact (Sovereignty deployments only).
- Download signed DPA (available on request).

## Settings — Audit Log (`/app/settings/audit-log`)

Table of audit events. Filter by action, user, date range. Export CSV button.

## Settings — Export and Delete (`/app/settings/export`)

- "Export all data" button. Triggers a background job; email when ready.
- "Delete organization" button. Dialog explaining 30-day soft delete. Requires typing the org name to confirm.

## Onboarding wizard (`/app/onboarding`)

Stepper, 6 steps (10 for Sovereignty deployments). Each step saves progress to `tenant_onboarding_state` so user can resume.

## Admin (`/admin`)

Maintainer-only, gated by email allowlist.

- Tenant list with tier, MRR, token spend, last active.
- Eval drift dashboard.
- Deadline queue depth.
- Prompt version management.
- Sovereignty provisioning status.

## Empty states

Every list page has an empty state with an illustration (simple line art, warm Alaska-themed colors) and a "Get started" CTA linking to the relevant creation flow.

## Loading states

- Skeletons for every list and detail view.
- Draft generation: streaming text with a "Critic is reviewing..." indicator showing which iteration and sub-score.
- Parse in progress: banner on document detail.

## Error states

- Toast for transient errors.
- Inline error with retry for data fetch failures.
- Field-level error on form validation.

## Accessibility

- Keyboard navigation on every interactive element.
- Focus ring visible on all focusable elements.
- aria-label on every icon-only button.
- Color contrast 4.5:1 minimum.
- Draft banner is `role="status" aria-live="polite"` so screen readers announce it.

## Dark mode

Supported via shadcn/ui's default theming. Respect `prefers-color-scheme`.

## Responsive

- Mobile: single-column, sidebar collapses to drawer.
- Tablet: two-pane on report detail.
- Desktop: three-pane on report detail.
- App is not optimized for phones; the marketing site and onboarding are.

## Typography and color

- Font: Inter (already bundled with Next.js). Headings are font-weight 600.
- Primary: `#0B4F6C` (deep Alaska blue).
- Accent: `#F2C14E` (aurora gold).
- Destructive: `#B91C1C` (draft banner border, delete buttons).
- Neutral scale: Tailwind gray.
- All tokens defined in `tailwind.config.ts`.
