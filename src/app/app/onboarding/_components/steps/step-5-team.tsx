"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { WizardShell } from "../wizard-shell";

interface InviteResult {
  email: string;
  status: "sent" | "failed";
}

export function Step5Team() {
  const [emailsText, setEmailsText] = useState("");
  const [results, setResults] = useState<InviteResult[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  const emails = emailsText
    .split("\n")
    .map((e) => e.trim())
    .filter(Boolean);

  async function sendInvites() {
    if (emails.length === 0) return;
    setSending(true);
    setError("");
    setResults([]);
    try {
      const res = await fetch("/api/team/invite", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ emails }),
      });
      if (!res.ok) {
        setError("Some invites could not be sent. Check email addresses and try again.");
        return;
      }
      const data = (await res.json()) as { results?: InviteResult[] };
      setResults(data.results ?? emails.map((e) => ({ email: e, status: "sent" as const })));
    } catch {
      setError("Network error while sending invites. Please try again.");
    } finally {
      setSending(false);
    }
  }

  return (
    <WizardShell step={5} nextLabel="Continue">
      <div className="space-y-5">
        <p className="text-sm text-muted-foreground">
          Invite team members by email. Each person will receive an email with a
          link to join your organization workspace. This step is optional.
        </p>

        {error && (
          <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        <div className="space-y-2">
          <Label htmlFor="team-emails">Email addresses (one per line)</Label>
          <textarea
            id="team-emails"
            value={emailsText}
            onChange={(e) => setEmailsText(e.target.value)}
            placeholder="alice@example.org&#10;bob@example.org"
            rows={5}
            className="flex min-h-[120px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>

        <Button
          type="button"
          variant="outline"
          onClick={sendInvites}
          disabled={emails.length === 0 || sending}
        >
          {sending ? "Sending..." : `Send ${emails.length || ""} invite${emails.length !== 1 ? "s" : ""}`}
        </Button>

        {results.length > 0 && (
          <ul className="space-y-1 text-sm">
            {results.map((r) => (
              <li
                key={r.email}
                className={r.status === "sent" ? "text-green-700" : "text-destructive"}
              >
                {r.email} — {r.status === "sent" ? "Invite sent." : "Failed to send."}
              </li>
            ))}
          </ul>
        )}
      </div>
    </WizardShell>
  );
}
