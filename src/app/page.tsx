import { FounderNote } from "@/components/marketing/founder-note";
import { Footer } from "@/components/marketing/footer";
import { Hero } from "@/components/marketing/hero";
import { Navbar } from "@/components/marketing/navbar";
import { OpenSource } from "@/components/marketing/open-source";
import { Problem } from "@/components/marketing/problem";
import { Sovereignty } from "@/components/marketing/sovereignty";
import { WaitlistForm } from "@/components/marketing/waitlist-form";
import { WhoFor } from "@/components/marketing/who-for";

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col">
      <Navbar />
      <main className="flex-1">
        <Hero />
        <Problem />
        <WhoFor />
        <OpenSource />
        <Sovereignty />
        <FounderNote />
        <WaitlistForm />
      </main>
      <Footer />
    </div>
  );
}
