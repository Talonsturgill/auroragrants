import { env } from "@/lib/env";

/**
 * Env-gated observability. When SENTRY_DSN is unset, captureError is a no-op.
 * The full @sentry/nextjs integration lands in a later phase once the Sentry
 * project exists. See docs/followups.md.
 */
export function captureError(err: unknown, context?: Record<string, unknown>): void {
  if (!env.SENTRY_DSN) {
    if (process.env.NODE_ENV !== "production") {
      console.error("[observability]", err, context ?? {});
    }
    return;
  }
  if (process.env.NODE_ENV !== "production") {
    console.error("[observability]", err, context ?? {});
  }
}

/**
 * Structured log without tenant content. Only tenant_id, action, duration,
 * status per /docs/03-sovereignty.md.
 */
export function logAction(payload: {
  tenant_id?: string | null;
  action: string;
  status: "ok" | "error";
  duration_ms?: number;
  metadata?: Record<string, unknown>;
}): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...payload });
  if (payload.status === "error") {
    console.error(line);
  } else {
    console.log(line);
  }
}
