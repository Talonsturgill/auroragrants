import { ClerkProvider, SignUp } from "@clerk/nextjs";

export const dynamic = "force-dynamic";

export default function SignUpPage() {
  return (
    <ClerkProvider>
      <div className="flex min-h-screen items-center justify-center bg-secondary/40 p-6">
        <SignUp />
      </div>
    </ClerkProvider>
  );
}
