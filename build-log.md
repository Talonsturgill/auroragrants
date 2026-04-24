# Build Log

Append one line per phase-boundary event. Most recent at bottom.

Format: `YYYY-MM-DD HH:MM TZ | phase N | <status> | <tests>`

Status values: `started`, `acceptance_passed`, `acceptance_failed`, `blocked`.

Tests: short list of suites that passed or failed.

## Examples

```
2026-11-01 09:00 AKST | phase 1 | started | -
2026-11-01 18:30 AKST | phase 1 | acceptance_passed | tenant-isolation, stripe-webhook, lighthouse
2026-11-02 08:00 AKST | phase 2 | started | -
2026-11-02 22:00 AKST | phase 2 | acceptance_passed | parser-bakeoff=0.91 F1, retrieval-top3=0.95
```
