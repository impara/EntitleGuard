import { desc } from "drizzle-orm";
import { db, leads, auditSummaries, events } from "@/db";
import {
  isSyntheticLead,
  summarizeAuditModes,
  summarizeFunnel,
  summarizeTrafficSources,
  type FunnelRow,
  type TrafficSourceRow,
} from "@/lib/admin-analytics";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Admin — EntitleGuard",
  robots: { index: false, follow: false },
};

type LeadRow = typeof leads.$inferSelect;
type SummaryRow = typeof auditSummaries.$inferSelect;

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
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

function LeadTable({ rows, summaryByLead }: { rows: LeadRow[]; summaryByLead: Map<number, SummaryRow> }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-edge">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-edge bg-surface text-xs uppercase tracking-wide text-muted">
          <tr>
            <th className="px-3 py-2">When</th><th className="px-3 py-2">Email</th>
            <th className="px-3 py-2">Company</th><th className="px-3 py-2">Role</th>
            <th className="px-3 py-2">MRR</th><th className="px-3 py-2">Billing / DB</th>
            <th className="px-3 py-2">Request</th><th className="px-3 py-2">Beta interests</th>
            <th className="px-3 py-2">Support incidents</th><th className="px-3 py-2">Audit summary</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((lead) => {
            const summary = summaryByLead.get(lead.id);
            return (
              <tr key={lead.id} className="border-b border-edge last:border-0">
                <td className="whitespace-nowrap px-3 py-2 text-muted">{formatDate(lead.createdAt)}</td>
                <td className="px-3 py-2 font-medium"><a href={`mailto:${lead.email}`} className="hover:text-accent">{lead.email}</a></td>
                <td className="px-3 py-2">{lead.company}</td><td className="px-3 py-2">{lead.role}</td>
                <td className="whitespace-nowrap px-3 py-2">{lead.mrrRange}</td>
                <td className="whitespace-nowrap px-3 py-2 text-muted">{lead.billingPlatform}{lead.databaseType ? ` / ${lead.databaseType}` : ""}</td>
                <td className="whitespace-nowrap px-3 py-2"><span className="rounded-full border border-edge px-2 py-0.5 text-xs">{lead.requestType.replaceAll("_", " ")}</span></td>
                <td className="px-3 py-2 text-muted">{parseInterests(lead.betaInterests)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-muted">{lead.supportIncidentFrequency?.replaceAll("_", " ") ?? "—"}</td>
                <td className="whitespace-nowrap px-3 py-2 text-muted">{summary ? `${summary.highConfidenceMismatches} high-conf · ${summary.exposureBucket}/mo` : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function FunnelTable({ rows }: { rows: FunnelRow[] }) {
  return (
    <div className="rounded-xl border border-edge bg-surface">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-edge text-xs uppercase tracking-wide text-muted"><tr><th className="px-3 py-2">Event</th><th className="px-3 py-2 text-right">Events</th><th className="px-3 py-2 text-right">Sessions</th></tr></thead>
        <tbody>{rows.map((row) => <tr key={row.name} className="border-b border-edge last:border-0"><td className="px-3 py-2 font-mono text-xs">{row.name}</td><td className="px-3 py-2 text-right font-semibold">{row.eventCount}</td><td className="px-3 py-2 text-right font-semibold">{row.sessionCount}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

function SourceTable({ rows }: { rows: TrafficSourceRow[] }) {
  return (
    <div className="rounded-xl border border-edge bg-surface">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-edge text-xs uppercase tracking-wide text-muted"><tr><th className="px-3 py-2">Source</th><th className="px-3 py-2 text-right">Views</th><th className="px-3 py-2 text-right">Sessions</th></tr></thead>
        <tbody>{rows.map((row) => <tr key={row.source} className="border-b border-edge last:border-0"><td className="max-w-xs truncate px-3 py-2 font-mono text-xs">{row.source}</td><td className="px-3 py-2 text-right font-semibold">{row.eventCount}</td><td className="px-3 py-2 text-right font-semibold">{row.sessionCount}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

export default function AdminPage() {
  const leadRows = db.select().from(leads).orderBy(desc(leads.id)).all();
  const summaryRows = db.select().from(auditSummaries).all();
  const eventRows = db.select({ sessionId: events.sessionId, name: events.name, props: events.props }).from(events).all();
  const summaryByLead = new Map<number, SummaryRow>();
  for (const summary of summaryRows) if (summary.leadId != null) summaryByLead.set(summary.leadId, summary);

  const syntheticLeads = leadRows.filter(isSyntheticLead);
  const realLeads = leadRows.filter((lead) => !isSyntheticLead(lead));
  const syntheticLeadIds = new Set(syntheticLeads.map((lead) => lead.id));
  const syntheticSessions = new Set(summaryRows.filter((summary) => summary.leadId != null && syntheticLeadIds.has(summary.leadId)).map((summary) => summary.sessionId));

  const funnelOrder = ["landing_page_viewed", "audit_started", "demo_mode_started", "stripe_csv_uploaded", "app_csv_uploaded", "mapping_completed", "mapping_dropoff", "audit_completed", "mismatches_found", "no_mismatches_found", "full_report_requested", "monitoring_cta_clicked", "beta_signup_submitted", "call_booked"];
  const funnel = summarizeFunnel(eventRows, syntheticSessions).sort((a, b) => {
    const aIndex = funnelOrder.indexOf(a.name); const bIndex = funnelOrder.indexOf(b.name);
    return (aIndex === -1 ? Number.MAX_SAFE_INTEGER : aIndex) - (bIndex === -1 ? Number.MAX_SAFE_INTEGER : bIndex);
  });
  const auditModes = summarizeAuditModes(eventRows, syntheticSessions);
  const sources = summarizeTrafficSources(eventRows, syntheticSessions);
  const regularSources = sources.filter((source) => !source.unverified);
  const unverifiedSources = sources.filter((source) => source.unverified);
  const landingSessions = funnel.find((row) => row.name === "landing_page_viewed")?.sessionCount ?? 0;
  const monitoringCtaSessions = funnel.find((row) => row.name === "monitoring_cta_clicked")?.sessionCount ?? 0;
  const betaApplications = realLeads.filter((lead) => lead.requestType === "monitoring_beta").length;

  return (
    <main className="mx-auto max-w-6xl px-4 py-10">
      <div className="mb-8 flex flex-wrap items-baseline justify-between gap-3">
        <div><h1 className="text-2xl font-bold">EntitleGuard admin</h1><a href="/admin/monitoring" className="mt-2 inline-block text-sm font-semibold text-accent hover:underline">Open monitoring operator →</a></div>
        <p className="text-sm text-muted">{realLeads.length} real lead{realLeads.length === 1 ? "" : "s"} · {syntheticLeads.length} synthetic test{syntheticLeads.length === 1 ? "" : "s"}</p>
      </div>

      <section className="mb-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {[["Landing sessions", landingSessions], ["Uploaded / unclassified audits", auditModes.uploadedOrUnknownSessions], ["Demo audits", auditModes.demoSessions], ["Monitoring CTA sessions", monitoringCtaSessions], ["Beta applications", betaApplications]].map(([label, value]) => <div key={label} className="rounded-xl border border-edge bg-surface p-4"><div className="text-2xl font-bold">{value}</div><div className="mt-1 text-xs text-muted">{label}</div></div>)}
      </section>

      <section className="mb-10">
        <h2 className="mb-3 text-lg font-semibold">Real leads</h2>
        {realLeads.length === 0 ? <p className="rounded-xl border border-edge bg-surface p-6 text-sm text-muted">No verified real leads yet. CTA clicks and demo audits are not counted as leads.</p> : <LeadTable rows={realLeads} summaryByLead={summaryByLead} />}
      </section>

      {syntheticLeads.length > 0 && <section className="mb-10"><h2 className="mb-1 text-lg font-semibold">Synthetic test data</h2><p className="mb-3 text-xs text-muted">Retained for traceability but excluded from lead, funnel, and traffic totals when its session can be linked.</p><LeadTable rows={syntheticLeads} summaryByLead={summaryByLead} /></section>}

      <div className="grid gap-10 md:grid-cols-2">
        <section><h2 className="mb-1 text-lg font-semibold">Event funnel</h2><p className="mb-3 text-xs text-muted">Events are raw actions; sessions are the better approximation of distinct visits. Known linked synthetic sessions are excluded.</p><FunnelTable rows={funnel} /></section>
        <section>
          <h2 className="mb-1 text-lg font-semibold">Landing traffic sources</h2><p className="mb-3 text-xs text-muted">Raw referrers are not proof of a human or qualified visit. Internal traffic not linked to a synthetic lead may still be present.</p><SourceTable rows={regularSources} />
          {unverifiedSources.length > 0 && <div className="mt-5"><h3 className="mb-1 text-sm font-semibold">Unverified / likely automated referrers</h3><p className="mb-2 text-xs text-muted">Shown separately and not treated as acquisition evidence.</p><SourceTable rows={unverifiedSources} /></div>}
          <p className="mt-2 text-xs text-muted">Direct/unknown includes older events without referrer properties.</p>
        </section>
      </div>
    </main>
  );
}
