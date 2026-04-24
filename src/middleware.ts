import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const isProtectedRoute = createRouteMatcher(["/app(.*)"]);

const isPublicApi = createRouteMatcher([
  "/api/webhooks/clerk",
  "/api/health",
  "/api/waitlist",
]);

// Routes that are always accessible inside /app (no onboarding redirect).
const isOnboardingExempt = createRouteMatcher([
  "/app/onboarding(.*)",
]);

// API routes inside /app that must not be redirected.
const isApiRoute = createRouteMatcher(["/api(.*)"]);

export default clerkMiddleware(async (auth, req) => {
  if (isPublicApi(req)) return;
  if (isProtectedRoute(req)) {
    await auth.protect();
  }

  // Onboarding guard: if the user is on an /app/* page (not onboarding and
  // not an API route) and their tenant has not completed onboarding, redirect
  // to the wizard.
  if (
    isProtectedRoute(req) &&
    !isOnboardingExempt(req) &&
    !isApiRoute(req)
  ) {
    try {
      const { orgId } = await auth();
      if (orgId) {
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

        if (supabaseUrl && serviceKey) {
          // Lightweight REST call — avoid importing the full Supabase client in
          // Edge-compatible middleware. We query tenants directly via PostgREST.
          const tenantRes = await fetch(
            `${supabaseUrl}/rest/v1/tenants?clerk_org_id=eq.${encodeURIComponent(orgId)}&select=id,onboarding_completed_at&limit=1`,
            {
              headers: {
                apikey: serviceKey,
                Authorization: `Bearer ${serviceKey}`,
                "Content-Type": "application/json",
              },
            },
          );

          if (tenantRes.ok) {
            const rows = (await tenantRes.json()) as {
              id: string;
              onboarding_completed_at: string | null;
            }[];

            if (rows.length > 0 && rows[0].onboarding_completed_at === null) {
              const onboardingUrl = new URL("/app/onboarding", req.url);
              return NextResponse.redirect(onboardingUrl);
            }
          }
        }
      }
    } catch {
      // DB not reachable or no tenant row yet — allow through.
    }
  }
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
