import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabaseForTenant } from "@/lib/supabase/server";

import {
  AwardForm,
  type AwardFormDocumentOption,
  type AwardFormFunderOption,
} from "../_components/award-form";

export const dynamic = "force-dynamic";

const ALLOWED_KINDS = new Set(["nofo", "past_proposal", "other"]);
const PARSE_READY = new Set(["parsed", "indexed"]);

export default async function NewAwardPage() {
  const { documents, funders } = await loadOptions();

  const canProceed = documents.length > 0 && funders.length > 0;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          <Link href="/app/awards" className="hover:underline">
            Awards
          </Link>{" "}
          / New
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">
          Register award
        </h1>
        <p className="text-sm text-muted-foreground">
          Tell us which document this award came from and we will extract the
          reporting requirements on submit.
        </p>
      </div>

      {documents.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Upload a document first</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>
              You need at least one parsed NOFO, past proposal, or other award
              document before you can register an award.
            </p>
            <Button asChild>
              <Link href="/app/documents">Go to documents</Link>
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {documents.length > 0 && funders.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Funder directory not loaded</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            <p>
              No funders are available yet. The Alaska funder graph seeds
              automatically once the database is provisioned. Try again in a
              moment.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {canProceed ? (
        <Card>
          <CardHeader>
            <CardTitle>Award details</CardTitle>
          </CardHeader>
          <CardContent>
            <AwardForm documents={documents} funders={funders} />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

async function loadOptions(): Promise<{
  documents: AwardFormDocumentOption[];
  funders: AwardFormFunderOption[];
}> {
  try {
    const { supabase, tenantId } = await supabaseForTenant();
    if (!tenantId) {
      return { documents: [], funders: [] };
    }

    const [docsRes, fundersRes] = await Promise.all([
      supabase
        .from("documents")
        .select("id, filename, kind, parse_status")
        .is("deleted_at", null)
        .order("created_at", { ascending: false }),
      supabase
        .from("funders")
        .select("id, name, type")
        .order("name", { ascending: true }),
    ]);

    const documents: AwardFormDocumentOption[] = (docsRes.data ?? [])
      .filter(
        (d: { parse_status?: string | null; kind?: string | null }) =>
          PARSE_READY.has((d.parse_status ?? "").toString()) &&
          ALLOWED_KINDS.has((d.kind ?? "").toString()),
      )
      .map((d: { id: string; filename: string; kind: string }) => ({
        id: d.id,
        filename: d.filename,
        kind: d.kind,
      }));

    const funders: AwardFormFunderOption[] = (fundersRes.data ?? []).map(
      (f: { id: string; name: string; type: string }) => ({
        id: f.id,
        name: f.name,
        type: f.type,
      }),
    );

    return { documents, funders };
  } catch {
    return { documents: [], funders: [] };
  }
}
