"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2 } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { APPROVAL_ATTESTATION_PHRASE } from "@/lib/types/draft";

interface ApproveButtonProps {
  fieldId: string;
  /** Set to true if the field is already approved. Renders a disabled pill. */
  alreadyApproved?: boolean;
  /** Set to true if the draft failed the quality gate. Blocks approval. */
  blocked?: boolean;
  className?: string;
  fetchImpl?: typeof fetch;
}

/**
 * "Mark field approved" button. Opens an attestation dialog. The reviewer
 * must type the exact phrase `I certify this is accurate.` before the POST
 * fires. This is the legal sign-off per CLAUDE.md.
 *
 * Request body is always `{ signer_attestation: true }`. The server is the
 * source of truth for whether the current user is the designated signer.
 */
export function ApproveButton({
  fieldId,
  alreadyApproved,
  blocked,
  className,
  fetchImpl,
}: ApproveButtonProps) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [typed, setTyped] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const doFetch = fetchImpl ?? (typeof fetch !== "undefined" ? fetch : null);

  const phraseMatches = typed.trim() === APPROVAL_ATTESTATION_PHRASE;

  async function onSubmit() {
    if (!phraseMatches || !doFetch) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await doFetch(
        `/api/report-fields/${fieldId}/approve`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ signer_attestation: true }),
        },
      );
      if (!res.ok) {
        setError(
          res.status === 403
            ? "You are not the designated signer for this report."
            : `Approval failed (${res.status}).`,
        );
        setSubmitting(false);
        return;
      }
      setOpen(false);
      setTyped("");
      setSubmitting(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Approval failed.");
      setSubmitting(false);
    }
  }

  if (alreadyApproved) {
    return (
      <Button
        type="button"
        size="sm"
        variant="secondary"
        disabled
        aria-disabled="true"
        className={className}
      >
        <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
        <span>Field approved</span>
      </Button>
    );
  }

  return (
    <>
      <Button
        type="button"
        size="sm"
        onClick={() => setOpen(true)}
        disabled={!!blocked}
        aria-disabled={blocked ? "true" : "false"}
        title={
          blocked
            ? "Draft did not pass the quality gate. Regenerate before approving."
            : undefined
        }
        className={cn(className)}
        data-testid="approve-field-button"
      >
        <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
        <span>Mark field approved</span>
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approve this field</DialogTitle>
            <DialogDescription>
              I am the authorized reviewer for this report. I have read this
              content. I certify that it is accurate to the best of my
              knowledge. Type the phrase below to continue.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="attestation-phrase">
              Type <span className="font-mono">{APPROVAL_ATTESTATION_PHRASE}</span>
            </Label>
            <Input
              id="attestation-phrase"
              autoComplete="off"
              spellCheck={false}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={APPROVAL_ATTESTATION_PHRASE}
              data-testid="attestation-input"
            />
            {error ? (
              <p
                role="alert"
                data-testid="approve-error"
                className="text-xs text-destructive"
              >
                {error}
              </p>
            ) : null}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setOpen(false);
                setTyped("");
                setError(null);
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={onSubmit}
              disabled={!phraseMatches || submitting}
              aria-disabled={!phraseMatches || submitting}
              data-testid="confirm-approve"
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
              )}
              <span>Confirm approval</span>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
