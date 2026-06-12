import { desc, sql } from "drizzle-orm";
import { db, leads, auditSummaries, events } from "@/db";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Admin — EntitleGuard",
  robots: { index: false, follow: false },
};

type LeadRow = typeof leads.$inferSelect;
type SummaryRow = typeof auditSummaries.$inferSelect;

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function parseInterests(json: string | null): string {
  if (!json) return "—";
  try {
    const list = JSON.parse(json) as string[];
    return list.length ? list.join(", ").replaceAll("_", " ") : "—";
  } catch {
    return json;
  }
}

export default function AdminPage() {
  const leadRows = db.select().from(leads).orderBy(desc(leads.id)).all();
  const summaryRows = db.select().from(auditSummaries).all();
  const summaryByLead = new Map<number, SummaryRow>();
  for (const s of summaryRows) {
    if (s.leadId != null) summaryByLead.set(s.leadId, s);
  }

  const funnel = db
    .select({ name: events.name, count: sql<number>`count(*)` })
    .from(events)
    .groupBy(events.name)
    .all();

  // Traffic sources from landing_page_viewed props (ref / referrer).
  const landingEvents = db
    .select({ props: events.props })
    .from(events)
    .where(sql`${events.name} = 'landing_page_viewed'`)
    .all();
  const sources = new Map<string, number>();
  for (const e of landingEvents) {
    let source = "(direct / unknown)";
    if (e.props) {
      try {
        const p = JSON.parse(e.props) as Record<string, string>;
        source = p.ref ?? p.referrer ?? source;
      } catch {
        /* ignore malformed props */
      }
    }
    sources.set(source, (sources.get(source) ?? 0) + 1);
  }

  const funnelOrder = [
    "landing_page_viewed",
    "audit_started",
    "demo_mode_started",
    "stripe_csv_uploaded",
    "app_csv_uploaded",
    "mapping_completed",
    "mapping_dropoff",
    "audit_completed",
    "mismatches_found",
    "no_mismatches_found",
    "full_report_requested",
    "beta_signup_submitted",
    "call_booked",
  ];
  const funnelSorted = [...funnel].sort(
    (a, b) => funnelOrder.indexOf(a.name) - funnelOrder.indexOf(b.name),
  );

  return (
    <main className="mx-auto max-w-6xl px-4 py-10">
      <div className="mb-8 flex items-baseline justify-between">
        <h1 className="text-2xl font-bold">EntitleGuard admin</h1>
        <p className="text-sm text-muted">
          {leadRows.length} lead{leadRows.length === 1 ? "" : "s"} · read-only
        </p>
      </div>

      <section className="mb-10">
        <h2 className="mb-3 text-lg font-semibold">Leads</h2>
        {leadRows.length === 0 ? (
          <p className="rounded-xl border border-edge bg-surface p-6 text-sm text-muted">
            No leads yet.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-edge">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-edge bg-surface text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-3 py-2">When</th>
                  <th className="px-3 py-2">Email</th>
                  <th className="px-3 py-2">Company</th>
                  <th className="px-3 py-2">Role</th>
                  <th className="px-3 py-2">MRR</th>
                  <th className="px-3 py-2">Billing / DB</th>
                  <th className="px-3 py-2">Request</th>
                  <th className="px-3 py-2">Beta interests</th>
                  <th className="px-3 py-2">Audit summary</th>
                </tr>
              </thead>
              <tbody>
                {leadRows.map((lead: LeadRow) => {
                  const summary = summaryByLead.get(lead.id);
                  return (
                    <tr key={lead.id} className="border-b border-edge last:border-0">
                      <td className="whitespace-nowrap px-3 py-2 text-muted">
                        {formatDate(lead.createdAt)}
                      </td>
                      <td className="px-3 py-2 font-medium">
                        <a href={`mailto:${lead.email}`} className="hover:text-accent">
                          {lead.email}
                        </a>
                      </td>
                      <td className="px-3 py-2">{lead.company}</td>
                      <td className="px-3 py-2">{lead.role}</td>
                      <td className="whitespace-nowrap px-3 py-2">{lead.mrrRange}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-muted">
                        {lead.billingPlatform}
                        {lead.databaseType ? ` / ${lead.databaseType}` : ""}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2">
                        <span className="rounded-full border border-edge px-2 py-0.5 text-xs">
                          {lead.requestType.replaceAll("_", " ")}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-muted">
                        {parseInterests(lead.betaInterests)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-muted">
                        {summary
                          ? `${summary.highConfidenceMismatches} high-conf · ${summary.exposureBucket}/mo`
                          : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="grid gap-10 md:grid-cols-2">
        <section>
          <h2 className="mb-3 text-lg font-semibold">Event funnel</h2>
          <div className="rounded-xl border border-edge bg-surface">
            <table className="w-full text-left text-sm">
              <tbody>
                {funnelSorted.map((row) => (
                  <tr key={row.name} className="border-b border-edge last:border-0">
                    <td className="px-3 py-2 font-mono text-xs">{row.name}</td>
                    <td className="px-3 py-2 text-right font-semibold">{row.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-lg font-semibold">Landing traffic sources</h2>
          <div className="rounded-xl border border-edge bg-surface">
            <table className="w-full text-left text-sm">
              <tbody>
                {[...sources.entries()]
                  .sort((a, b) => b[1] - a[1])
                  .map(([source, count]) => (
                    <tr key={source} className="border-b border-edge last:border-0">
                      <td className="max-w-xs truncate px-3 py-2 font-mono text-xs">
                        {source}
                      </td>
                      <td className="px-3 py-2 text-right font-semibold">{count}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-muted">
            From landing_page_viewed props (ref param / document.referrer). Older
            deployments logged no props, shown as direct/unknown.
          </p>
        </section>
      </div>
    </main>
  );
}
