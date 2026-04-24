"use client";

import { useState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { WizardShell } from "../wizard-shell";

const ORG_TYPES = [
  { value: "501c3", label: "501(c)(3) Nonprofit" },
  { value: "tribal_gov", label: "Tribal Government" },
  { value: "tribal_nonprofit", label: "Tribal Nonprofit" },
  { value: "ancsa_regional_nonprofit", label: "ANCSA Regional Nonprofit" },
  { value: "municipality", label: "Municipality" },
  { value: "other", label: "Other" },
] as const;

interface Props {
  initialName?: string;
  initialEin?: string;
  initialOrgType?: string;
  initialAddress?: string;
  initialContactName?: string;
  initialContactEmail?: string;
  initialPhone?: string;
}

export function Step1OrgInfo({
  initialName = "",
  initialEin = "",
  initialOrgType = "",
  initialAddress = "",
  initialContactName = "",
  initialContactEmail = "",
  initialPhone = "",
}: Props) {
  const [name, setName] = useState(initialName);
  const [ein, setEin] = useState(initialEin);
  const [orgType, setOrgType] = useState(initialOrgType);
  const [address, setAddress] = useState(initialAddress);
  const [contactName, setContactName] = useState(initialContactName);
  const [contactEmail, setContactEmail] = useState(initialContactEmail);
  const [phone, setPhone] = useState(initialPhone);
  const [error, setError] = useState("");

  async function handleNext(): Promise<boolean> {
    setError("");
    if (!name.trim()) {
      setError("Organization name is required.");
      return false;
    }

    const res = await fetch("/api/onboarding/org-info", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        ein: ein.trim() || null,
        org_type: orgType || null,
        primary_address: address.trim() || null,
        primary_contact_name: contactName.trim() || null,
        primary_contact_email: contactEmail.trim() || null,
        primary_phone: phone.trim() || null,
      }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError((data as { error?: string }).error ?? "Save failed. Please try again.");
      return false;
    }
    return true;
  }

  return (
    <WizardShell step={1} onNext={handleNext} nextDisabled={!name.trim()}>
      <div className="space-y-5">
        <p className="text-sm text-muted-foreground">
          Tell us about your organization. This information will appear on your compliance reports.
        </p>

        {error && (
          <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        <div className="space-y-2">
          <Label htmlFor="org-name">
            Organization name <span className="text-destructive">*</span>
          </Label>
          <Input
            id="org-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Kenai Peninsula Tribal Health Consortium"
            maxLength={200}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="ein">EIN (optional)</Label>
          <Input
            id="ein"
            value={ein}
            onChange={(e) => setEin(e.target.value)}
            placeholder="12-3456789"
            maxLength={20}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="org-type">Organization type</Label>
          <select
            id="org-type"
            value={orgType}
            onChange={(e) => setOrgType(e.target.value)}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <option value="">Select a type</option>
            {ORG_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="address">Primary address</Label>
          <textarea
            id="address"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="123 Main St, Soldotna, AK 99669"
            maxLength={500}
            rows={3}
            className="flex min-h-[80px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="contact-name">Primary contact name</Label>
            <Input
              id="contact-name"
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
              placeholder="Jane Smith"
              maxLength={200}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="contact-email">Primary contact email</Label>
            <Input
              id="contact-email"
              type="email"
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
              placeholder="jane@example.org"
              maxLength={200}
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="phone">Primary phone</Label>
          <Input
            id="phone"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="(907) 555-0100"
            maxLength={30}
          />
        </div>
      </div>
    </WizardShell>
  );
}
