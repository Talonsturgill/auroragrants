"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export interface AwardFormDocumentOption {
  id: string;
  filename: string;
  kind: string;
}

export interface AwardFormFunderOption {
  id: string;
  name: string;
  type: string;
}

interface AwardFormProps {
  documents: AwardFormDocumentOption[];
  funders: AwardFormFunderOption[];
}

/**
 * Zod schema for the new-award form. Dates are captured as yyyy-mm-dd strings
 * from the native date inputs and passed through to the server as ISO dates.
 * The server is the source of truth for tenant_id and extraction_status, so
 * neither is sent from the client.
 */
export const AwardFormSchema = z
  .object({
    source_document_id: z
      .string()
      .uuid({ message: "Pick a source document." }),
    funder_id: z.string().uuid({ message: "Pick a funder." }),
    program_name: z
      .string()
      .trim()
      .min(1, { message: "Program name is required." })
      .max(255, { message: "Keep it under 255 characters." }),
    amount_usd: z
      .number({ invalid_type_error: "Enter an amount in whole dollars." })
      .int({ message: "Whole dollars only." })
      .positive({ message: "Amount must be greater than zero." }),
    awarded_at: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, { message: "Pick the awarded date." }),
    period_start: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, { message: "Pick a period start date." }),
    period_end: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, { message: "Pick a period end date." }),
    award_number: z.string().trim().max(128).optional().or(z.literal("")),
    cfda_number: z.string().trim().max(32).optional().or(z.literal("")),
    uei: z.string().trim().max(32).optional().or(z.literal("")),
  })
  .refine(
    (d) =>
      new Date(d.period_end).getTime() > new Date(d.period_start).getTime(),
    { path: ["period_end"], message: "Period end must be after period start." },
  );

export type AwardFormValues = z.infer<typeof AwardFormSchema>;

type FieldErrors = Partial<Record<keyof AwardFormValues | "_root", string>>;

const INITIAL_VALUES = {
  source_document_id: "",
  funder_id: "",
  program_name: "",
  amount_usd: "",
  awarded_at: "",
  period_start: "",
  period_end: "",
  award_number: "",
  cfda_number: "",
  uei: "",
};

type FormState = typeof INITIAL_VALUES;

export function AwardForm({ documents, funders }: AwardFormProps) {
  const router = useRouter();
  const [values, setValues] = useState<FormState>(INITIAL_VALUES);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const handle = window.setTimeout(() => setToast(null), 6000);
    return () => window.clearTimeout(handle);
  }, [toast]);

  const setField = useCallback(
    (key: keyof FormState) =>
      (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const v = e.target.value;
        setValues((prev) => ({ ...prev, [key]: v }));
        if (errors[key as keyof AwardFormValues]) {
          setErrors((prev) => ({ ...prev, [key]: undefined }));
        }
      },
    [errors],
  );

  const noDocuments = documents.length === 0;
  const noFunders = funders.length === 0;

  const onSubmit = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      setErrors({});

      const raw = {
        ...values,
        amount_usd:
          values.amount_usd === "" ? NaN : Number(values.amount_usd),
        award_number: values.award_number.trim() || undefined,
        cfda_number: values.cfda_number.trim() || undefined,
        uei: values.uei.trim() || undefined,
      };

      const parsed = AwardFormSchema.safeParse(raw);
      if (!parsed.success) {
        const flat: FieldErrors = {};
        for (const issue of parsed.error.issues) {
          const key = (issue.path[0] as keyof AwardFormValues) ?? "_root";
          if (!flat[key]) flat[key] = issue.message;
        }
        setErrors(flat);
        return;
      }

      setSubmitting(true);
      try {
        const payload = {
          ...parsed.data,
          award_number: parsed.data.award_number || undefined,
          cfda_number: parsed.data.cfda_number || undefined,
          uei: parsed.data.uei || undefined,
        };
        const res = await fetch("/api/awards", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (res.status === 201) {
          const body = (await res.json()) as { id?: string; award?: { id: string } };
          const id = body.id ?? body.award?.id;
          if (!id) {
            setToast("Award was created but the response was malformed.");
            return;
          }
          router.push(`/app/awards/${id}`);
          return;
        }

        if (res.status === 400) {
          const body = (await res
            .json()
            .catch(() => ({}))) as {
            details?: { fieldErrors?: Record<string, string[]> };
            error?: string;
          };
          const fieldErrors = body.details?.fieldErrors ?? {};
          const flat: FieldErrors = {};
          for (const [key, msgs] of Object.entries(fieldErrors)) {
            if (msgs && msgs.length > 0) {
              flat[key as keyof AwardFormValues] = msgs[0];
            }
          }
          if (Object.keys(flat).length === 0) {
            flat._root = body.error ?? "Please fix the errors and try again.";
          }
          setErrors(flat);
          return;
        }

        setToast(`Could not register the award. Server returned ${res.status}.`);
      } catch (err) {
        setToast(
          err instanceof Error
            ? err.message
            : "Could not register the award. Check your connection and try again.",
        );
      } finally {
        setSubmitting(false);
      }
    },
    [router, values],
  );

  const fieldError = (key: keyof AwardFormValues) => errors[key];

  const docOptions = useMemo(
    () =>
      documents.map((d) => ({
        value: d.id,
        label: `${d.filename} (${d.kind})`,
      })),
    [documents],
  );

  const funderOptions = useMemo(
    () =>
      funders.map((f) => ({
        value: f.id,
        label: `${f.name} (${f.type})`,
      })),
    [funders],
  );

  return (
    <form
      noValidate
      className="space-y-6"
      onSubmit={onSubmit}
      aria-describedby={errors._root ? "award-form-root-error" : undefined}
    >
      {errors._root ? (
        <div
          id="award-form-root-error"
          role="alert"
          className="rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {errors._root}
        </div>
      ) : null}

      <FieldGroup
        id="source_document_id"
        label="Source document"
        hint="The parsed award letter or NOFO to extract reporting requirements from."
        error={fieldError("source_document_id")}
      >
        <select
          id="source_document_id"
          name="source_document_id"
          value={values.source_document_id}
          onChange={setField("source_document_id")}
          aria-invalid={Boolean(fieldError("source_document_id"))}
          disabled={noDocuments}
          className={cn(
            "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
            fieldError("source_document_id") && "border-destructive",
          )}
        >
          <option value="" disabled>
            {noDocuments
              ? "No parsed documents available. Upload one first."
              : "Select a parsed document..."}
          </option>
          {docOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </FieldGroup>

      <FieldGroup
        id="funder_id"
        label="Funder"
        error={fieldError("funder_id")}
      >
        <select
          id="funder_id"
          name="funder_id"
          value={values.funder_id}
          onChange={setField("funder_id")}
          aria-invalid={Boolean(fieldError("funder_id"))}
          disabled={noFunders}
          className={cn(
            "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
            fieldError("funder_id") && "border-destructive",
          )}
        >
          <option value="" disabled>
            {noFunders ? "No funders loaded." : "Select a funder..."}
          </option>
          {funderOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </FieldGroup>

      <FieldGroup
        id="program_name"
        label="Program name"
        error={fieldError("program_name")}
      >
        <Input
          id="program_name"
          name="program_name"
          value={values.program_name}
          onChange={setField("program_name")}
          aria-invalid={Boolean(fieldError("program_name"))}
          placeholder="Tier 1 Community Support"
          autoComplete="off"
        />
      </FieldGroup>

      <div className="grid gap-4 sm:grid-cols-2">
        <FieldGroup
          id="amount_usd"
          label="Amount (USD)"
          hint="Whole dollars."
          error={fieldError("amount_usd")}
        >
          <Input
            id="amount_usd"
            name="amount_usd"
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            value={values.amount_usd}
            onChange={setField("amount_usd")}
            aria-invalid={Boolean(fieldError("amount_usd"))}
          />
        </FieldGroup>

        <FieldGroup
          id="awarded_at"
          label="Awarded at"
          error={fieldError("awarded_at")}
        >
          <Input
            id="awarded_at"
            name="awarded_at"
            type="date"
            value={values.awarded_at}
            onChange={setField("awarded_at")}
            aria-invalid={Boolean(fieldError("awarded_at"))}
          />
        </FieldGroup>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <FieldGroup
          id="period_start"
          label="Period start"
          error={fieldError("period_start")}
        >
          <Input
            id="period_start"
            name="period_start"
            type="date"
            value={values.period_start}
            onChange={setField("period_start")}
            aria-invalid={Boolean(fieldError("period_start"))}
          />
        </FieldGroup>

        <FieldGroup
          id="period_end"
          label="Period end"
          error={fieldError("period_end")}
        >
          <Input
            id="period_end"
            name="period_end"
            type="date"
            value={values.period_end}
            onChange={setField("period_end")}
            aria-invalid={Boolean(fieldError("period_end"))}
          />
        </FieldGroup>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <FieldGroup
          id="award_number"
          label="Award number"
          hint="Optional."
          error={fieldError("award_number")}
        >
          <Input
            id="award_number"
            name="award_number"
            value={values.award_number}
            onChange={setField("award_number")}
            aria-invalid={Boolean(fieldError("award_number"))}
            autoComplete="off"
          />
        </FieldGroup>

        <FieldGroup
          id="cfda_number"
          label="CFDA number"
          hint="Optional."
          error={fieldError("cfda_number")}
        >
          <Input
            id="cfda_number"
            name="cfda_number"
            value={values.cfda_number}
            onChange={setField("cfda_number")}
            aria-invalid={Boolean(fieldError("cfda_number"))}
            autoComplete="off"
          />
        </FieldGroup>

        <FieldGroup
          id="uei"
          label="UEI"
          hint="Optional."
          error={fieldError("uei")}
        >
          <Input
            id="uei"
            name="uei"
            value={values.uei}
            onChange={setField("uei")}
            aria-invalid={Boolean(fieldError("uei"))}
            autoComplete="off"
          />
        </FieldGroup>
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={submitting}>
          {submitting ? "Registering..." : "Register award"}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => router.push("/app/awards")}
          disabled={submitting}
        >
          Cancel
        </Button>
      </div>

      {toast ? (
        <div
          role="alert"
          className="fixed bottom-6 right-6 max-w-sm rounded-md border bg-destructive px-4 py-3 text-sm text-destructive-foreground shadow-lg"
        >
          {toast}
        </div>
      ) : null}
    </form>
  );
}

function FieldGroup({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && !error ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
      {error ? (
        <p
          className="text-xs text-destructive"
          role="alert"
          data-testid={`error-${id}`}
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
