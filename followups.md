# Followups

When Claude Code notices an issue or improvement outside the current task's scope, it logs it here instead of fixing inline. The founder reviews at phase boundaries.

Format: date, severity, phase noticed, description, suggested fix.

## Template

```
## YYYY-MM-DD — [severity] — Phase N

**Noticed:** <what>
**Suggested fix:** <what>
**Cost estimate:** <hours>
**Blocks?:** <phase or feature this blocks if any>
```

Severity values: `critical` (security or data loss), `high` (user-facing bug), `medium` (dev experience), `low` (nits).
