export interface AdminEventRow {
  sessionId: string;
  name: string;
  props: string | null;
}

export interface FunnelRow {
  name: string;
  eventCount: number;
  sessionCount: number;
}

export interface TrafficSourceRow {
  source: string;
  eventCount: number;
  sessionCount: number;
  unverified: boolean;
}

const UNVERIFIED_REFERRER_HOSTS = new Set([
  "roozzy.com",
  "www.roozzy.com",
  "sysoon.com",
  "www.sysoon.com",
]);

export function isSyntheticLead(lead: { email: string; company: string; role: string }): boolean {
  const email = lead.email.trim().toLowerCase();
  const company = lead.company.trim().toLowerCase();
  const role = lead.role.trim().toLowerCase();
  return (
    email === "e2e-test@amertech.online" ||
    company === "e2e-test.example" ||
    role === "e2e test (automated)"
  );
}

function parseProps(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function summarizeFunnel(
  rows: AdminEventRow[],
  excludedSessions: ReadonlySet<string>,
): FunnelRow[] {
  const grouped = new Map<string, { events: number; sessions: Set<string> }>();
  for (const row of rows) {
    if (excludedSessions.has(row.sessionId)) continue;
    const current = grouped.get(row.name) ?? { events: 0, sessions: new Set<string>() };
    current.events += 1;
    current.sessions.add(row.sessionId);
    grouped.set(row.name, current);
  }
  return [...grouped.entries()].map(([name, value]) => ({
    name,
    eventCount: value.events,
    sessionCount: value.sessions.size,
  }));
}

export function summarizeAuditModes(
  rows: AdminEventRow[],
  excludedSessions: ReadonlySet<string>,
): { demoSessions: number; uploadedOrUnknownSessions: number } {
  const demoSessions = new Set<string>();
  const completedSessions = new Set<string>();

  for (const row of rows) {
    if (excludedSessions.has(row.sessionId)) continue;
    const props = parseProps(row.props);
    if (row.name === "demo_mode_started" || (row.name === "audit_completed" && props.mode === "demo")) {
      demoSessions.add(row.sessionId);
    }
    if (row.name === "audit_completed") completedSessions.add(row.sessionId);
  }

  let completedDemoSessions = 0;
  for (const sessionId of completedSessions) {
    if (demoSessions.has(sessionId)) completedDemoSessions += 1;
  }
  return {
    demoSessions: completedDemoSessions,
    uploadedOrUnknownSessions: completedSessions.size - completedDemoSessions,
  };
}

function isUnverifiedReferrer(source: string): boolean {
  try {
    return UNVERIFIED_REFERRER_HOSTS.has(new URL(source).hostname.toLowerCase());
  } catch {
    return false;
  }
}

export function summarizeTrafficSources(
  rows: AdminEventRow[],
  excludedSessions: ReadonlySet<string>,
): TrafficSourceRow[] {
  const grouped = new Map<string, { events: number; sessions: Set<string> }>();
  for (const row of rows) {
    if (row.name !== "landing_page_viewed" || excludedSessions.has(row.sessionId)) continue;
    const props = parseProps(row.props);
    const source =
      (typeof props.ref === "string" && props.ref) ||
      (typeof props.referrer === "string" && props.referrer) ||
      "(direct / unknown)";
    const current = grouped.get(source) ?? { events: 0, sessions: new Set<string>() };
    current.events += 1;
    current.sessions.add(row.sessionId);
    grouped.set(source, current);
  }

  return [...grouped.entries()]
    .map(([source, value]) => ({
      source,
      eventCount: value.events,
      sessionCount: value.sessions.size,
      unverified: isUnverifiedReferrer(source),
    }))
    .sort((a, b) => b.sessionCount - a.sessionCount || b.eventCount - a.eventCount);
}
