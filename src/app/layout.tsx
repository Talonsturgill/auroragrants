import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { Inter } from "next/font/google";

import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "AuroraGrants — Grant compliance built for Alaska",
  description:
    "AuroraGrants helps Alaska nonprofits and tribal organizations draft, review, and submit grant reports in a fraction of the time, with human review and tribal data sovereignty built in. Free and open source under Apache-2.0.",
  metadataBase: new URL(process.env.APP_URL ?? "http://localhost:3000"),
  openGraph: {
    title: "AuroraGrants",
    description: "Grant compliance built for Alaska. Apache-2.0 open source.",
    url: "/",
    siteName: "AuroraGrants",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ClerkProvider>
      <html lang="en" className={inter.variable} suppressHydrationWarning>
        <body className="min-h-screen bg-background font-sans text-foreground">
          {children}
        </body>
      </html>
    </ClerkProvider>
  );
}
