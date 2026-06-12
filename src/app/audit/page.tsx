import type { Metadata } from "next";
import { SiteHeader } from "@/components/SiteHeader";
import { AuditWizard } from "@/components/audit/AuditWizard";

export const metadata: Metadata = {
  title: "Run a local entitlement drift audit — EntitleGuard",
};

interface AuditPageProps {
  searchParams: Promise<{ demo?: string }>;
}

export default async function AuditPage({ searchParams }: AuditPageProps) {
  const { demo } = await searchParams;
  return (
    <>
      <SiteHeader />
      <main className="flex-1">
        <div className="mx-auto max-w-5xl px-4 pb-2 pt-10">
          <h1 className="text-2xl font-bold">Local entitlement drift audit</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted">
            Upload a Stripe export and an app user export. The comparison runs entirely in
            your browser — your CSV files never leave this page.
          </p>
        </div>
        <div className="pt-8">
          <AuditWizard demo={demo === "1"} />
        </div>
      </main>
    </>
  );
}
