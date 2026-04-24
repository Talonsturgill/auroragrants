"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const REGION_OPTIONS = [
  { value: "us-west-2", label: "US West (Oregon) — us-west-2" },
  { value: "us-gov-west-1", label: "AWS GovCloud (US-West) — us-gov-west-1" },
] as const;

export default function SovereigntyPage() {
  const router = useRouter();
  const [tduaDone, setTduaDone] = useState(false);
  const [region, setRegion] = useState("us-west-2");
  const [byokArn, setByokArn] = useState("");
  const [advisoryContact, setAdvisoryContact] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleFinish() {
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/onboarding/sovereignty", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          data_residency: region,
          byok_key_arn: byokArn.trim() || null,
          advisory_contact: advisoryContact.trim() || null,
          tdua_signed: tduaDone,
        }),
      });
      if (!res.ok) {
        setError("Could not save sovereignty settings. Please try again.");
        return;
      }
      router.push("/app");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-8 py-10">
      <div>
        <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
          Sovereignty setup
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          Sovereignty deployment
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Complete these steps to activate your dedicated Sovereignty
          deployment. All features are free.
        </p>
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </p>
      )}

      {/* Card 1: TDUA */}
      <Card className="space-y-4 p-5">
        <div>
          <h2 className="text-base font-semibold">
            Sign Tribal Data Use Agreement
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            The TDUA governs how AuroraGrants handles your organization&apos;s data.
            Read the agreement and mark it complete when you are ready.
          </p>
        </div>
        <div className="flex items-center gap-4">
          <Button asChild variant="outline" size="sm">
            <Link href="/docs/tdua.pdf" target="_blank" rel="noreferrer">
              View TDUA (PDF)
            </Link>
          </Button>
          <Button
            size="sm"
            variant={tduaDone ? "outline" : "default"}
            onClick={() => setTduaDone((v) => !v)}
          >
            {tduaDone ? "Marked complete" : "Mark as complete"}
          </Button>
        </div>
        {tduaDone && (
          <p className="text-sm text-green-700">
            TDUA acknowledged. Timestamp will be recorded on save.
          </p>
        )}
      </Card>

      {/* Card 2: Data residency */}
      <Card className="space-y-4 p-5">
        <div>
          <h2 className="text-base font-semibold">Data residency</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Choose the AWS region where your data will be stored and processed.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="region">AWS region</Label>
          <select
            id="region"
            value={region}
            onChange={(e) => setRegion(e.target.value)}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            {REGION_OPTIONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
      </Card>

      {/* Card 3: BYOK */}
      <Card className="space-y-4 p-5">
        <div>
          <h2 className="text-base font-semibold">BYOK key ARN</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Provide an AWS KMS key ARN to use your own encryption key. Leave
            blank to use AuroraGrants-managed encryption.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="byok">KMS key ARN (optional)</Label>
          <Input
            id="byok"
            value={byokArn}
            onChange={(e) => setByokArn(e.target.value)}
            placeholder="arn:aws:kms:us-west-2:123456789012:key/..."
            maxLength={500}
          />
        </div>
      </Card>

      {/* Card 4: Advisory council contact */}
      <Card className="space-y-4 p-5">
        <div>
          <h2 className="text-base font-semibold">Advisory council contact</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Provide the name and email of your tribal advisory council contact.
            This is used for sovereignty governance communication.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="advisory">Name and email (optional)</Label>
          <Input
            id="advisory"
            value={advisoryContact}
            onChange={(e) => setAdvisoryContact(e.target.value)}
            placeholder="Jane Doe, jane@tribalcouncil.org"
            maxLength={500}
          />
        </div>
      </Card>

      <div className="flex justify-end gap-3">
        <Button variant="ghost" onClick={() => router.push("/app")}>
          Skip for now
        </Button>
        <Button onClick={handleFinish} disabled={saving}>
          {saving ? "Saving..." : "Finish"}
        </Button>
      </div>
    </div>
  );
}
