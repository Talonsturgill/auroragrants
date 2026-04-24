"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const ORG_TYPES = [
  "Anchorage 501(c)(3)",
  "ANCSA regional nonprofit",
  "Tribal government or consortium",
  "Municipality",
  "Other",
] as const;

const INTERESTS = ["Hosted version", "Self-host", "Sovereignty deployment"] as const;

export function WaitlistForm() {
  const [status, setStatus] = useState<"idle" | "submitting" | "ok" | "err">(
    "idle",
  );
  const [message, setMessage] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus("submitting");
    const form = e.currentTarget;
    const data = new FormData(form);
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.fromEntries(data.entries())),
      });
      if (!res.ok) throw new Error(`Status ${res.status}`);
      setStatus("ok");
      setMessage("You are on the list. We will be in touch.");
      form.reset();
    } catch {
      setStatus("err");
      setMessage("Something went wrong. Please try again.");
    }
  }

  return (
    <section id="waitlist" className="container py-20">
      <div className="mx-auto max-w-xl rounded-lg border bg-card p-8 shadow-sm">
        <h2 className="text-2xl font-semibold tracking-tight">
          Get notified when we launch.
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          We will email you when the hosted version is ready, and when the
          self-hosting guide lands. Free for everyone.
        </p>
        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              required
              placeholder="you@example.org"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="org">Organization</Label>
            <Input
              id="org"
              name="org"
              type="text"
              required
              placeholder="Tanana Chiefs Conference"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="org_type">Org type</Label>
              <select
                id="org_type"
                name="org_type"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                required
              >
                {ORG_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="interest">Interest</Label>
              <select
                id="interest"
                name="interest"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                required
              >
                {INTERESTS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <Button type="submit" disabled={status === "submitting"} className="w-full">
            {status === "submitting" ? "Submitting..." : "Notify me"}
          </Button>
          {message ? (
            <p
              role="status"
              aria-live="polite"
              className={
                status === "ok"
                  ? "text-sm text-primary"
                  : "text-sm text-destructive"
              }
            >
              {message}
            </p>
          ) : null}
        </form>
      </div>
    </section>
  );
}
