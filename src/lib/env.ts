function required(name: string, value: string | undefined): string {
  if (!value || value === "placeholder") {
    if (process.env.NODE_ENV === "production") {
      throw new Error(`Missing required env var: ${name}`);
    }
    return value ?? "";
  }
  return value;
}

export const env = {
  APP_URL: process.env.APP_URL ?? "http://localhost:3000",
  APP_ENV: (process.env.APP_ENV ?? "development") as
    | "development"
    | "preview"
    | "production",

  SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",

  CLERK_WEBHOOK_SECRET: process.env.CLERK_WEBHOOK_SECRET ?? "",

  SENTRY_DSN: process.env.SENTRY_DSN ?? "",
} as const;

export function requireServerEnv(): void {
  required("NEXT_PUBLIC_SUPABASE_URL", env.SUPABASE_URL);
  required("SUPABASE_SERVICE_ROLE_KEY", env.SUPABASE_SERVICE_ROLE_KEY);
}
