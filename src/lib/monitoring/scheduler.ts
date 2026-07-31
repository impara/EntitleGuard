import { and, eq } from "drizzle-orm";
import nodemailer from "nodemailer";
import { z } from "zod";
import {
  db as defaultDb,
  monitoringAlertNotifications,
  monitoringAlerts,
  monitoringJobs,
  monitoringScheduleExecutions,
  type DatabaseClient,
} from "../../db";
import { ingestMonitoringRun } from "./ingest-run";

const DEFAULT_SOURCE_TIMEOUT_MS = 60_000;
const DEFAULT_EMAIL_TIMEOUT_MS = 20_000;
const STALE_EXECUTION_MS = 60 * 60 * 1_000;
const RESEND_ENDPOINT = "https://api.resend.com/emails";

const timestampSchema = z
  .string()
  .min(1)
  .max(64)
  .refine((value) => !Number.isNaN(new Date(value).getTime()), "Invalid timestamp");

const sourceFindingSchema = z
  .object({
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/i),
    category: z.enum(["A", "B", "C", "D", "E"]),
    direction: z.enum(["grant", "revoke"]).nullable().optional(),
    severity: z.enum(["high", "medium", "low"]),
    manualOverride: z.boolean().optional(),
    overrideActor: z.string().max(200).nullable().optional(),
    overrideReason: z.string().max(1_000).nullable().optional(),
    overrideExpiresAt: timestampSchema.nullable().optional(),
  })
  .strict();

const sourceSnapshotSchema = z
  .object({
    completeSnapshot: z.literal(true),
    startedAt: timestampSchema.optional(),
    completedAt: timestampSchema.optional(),
    totalAppRecords: z.number().int().nonnegative(),
    totalStripeRecords: z.number().int().nonnegative(),
    findings: z.array(sourceFindingSchema).max(50_000),
  })
  .strict();

export interface MonitoringSchedulerConfig {
  sourceUrl: string;
  sourceToken?: string;
  alertTo: string[];
  alertFrom: string;
  resendApiKey?: string;
  smtp?: {
    host: string;
    port: number;
    user: string;
    pass: string;
    secure?: boolean;
  };
  publicUrl?: string;
  allowInsecureSource?: boolean;
  sourceTimeoutMs?: number;
  emailTimeoutMs?: number;
}

export interface MonitoringScheduledJobResult {
  jobId: number;
  jobName: string;
  status: "completed" | "skipped" | "failed";
  runId?: number;
  alertsDelivered?: number;
  reason?: string;
}

export interface MonitoringSchedulerResult {
  scheduleKey: string;
  startedAt: string;
  completedAt: string;
  jobs: MonitoringScheduledJobResult[];
  completed: number;
  skipped: number;
  failed: number;
}

interface SchedulerDependencies {
  now?: Date;
  fetch?: typeof fetch;
  sendEmail?: (message: OutboundAlertEmail) => Promise<{ id?: string }>;
}

export interface OutboundAlertEmail {
  from: string;
  to: string[];
  subject: string;
  text: string;
  html: string;
}

interface ClaimedExecution {
  id: number;
  attemptCount: number;
}

interface AlertRow {
  id: number;
  type: string;
  severity: string;
  status: string;
  title: string;
  details: string;
  occurrenceCount: number;
  lastTriggeredAt: string | null;
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 2_000);
  return String(error).slice(0, 2_000);
}

function utcScheduleKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function assertConfig(config: MonitoringSchedulerConfig): void {
  let source: URL;
  try {
    source = new URL(config.sourceUrl);
  } catch {
    throw new Error("MONITORING_SOURCE_URL must be a valid URL");
  }

  const localHttp =
    source.protocol === "http:" &&
    (source.hostname === "localhost" || source.hostname === "127.0.0.1" || source.hostname === "::1");
  if (source.protocol !== "https:" && !(config.allowInsecureSource && localHttp)) {
    throw new Error("MONITORING_SOURCE_URL must use HTTPS in production");
  }
  if (config.alertTo.length === 0 || config.alertTo.some((recipient) => !recipient.includes("@"))) {
    throw new Error("MONITORING_ALERT_TO must contain at least one email address");
  }
  if (!config.alertFrom.trim()) throw new Error("MONITORING_ALERT_FROM is required");
  const resendConfigured = Boolean(config.resendApiKey?.trim());
  const smtpConfigured = Boolean(
    config.smtp?.host.trim() &&
      config.smtp.user.trim() &&
      config.smtp.pass.trim() &&
      Number.isInteger(config.smtp.port) &&
      config.smtp.port > 0 &&
      config.smtp.port <= 65_535,
  );
  if (!resendConfigured && !smtpConfigured) {
    throw new Error("Configure RESEND_API_KEY or SMTP_HOST, SMTP_USER, and SMTP_PASS");
  }
}

function claimExecution(
  database: DatabaseClient,
  jobId: number,
  scheduleKey: string,
  now: Date,
): ClaimedExecution | null {
  const existing = database
    .select()
    .from(monitoringScheduleExecutions)
    .where(
      and(
        eq(monitoringScheduleExecutions.jobId, jobId),
        eq(monitoringScheduleExecutions.scheduleKey, scheduleKey),
      ),
    )
    .get();

  if (existing?.status === "completed") return null;
  if (
    existing?.status === "running" &&
    now.getTime() - new Date(existing.startedAt).getTime() < STALE_EXECUTION_MS
  ) {
    return null;
  }

  const nowIso = now.toISOString();
  if (existing) {
    database
      .update(monitoringScheduleExecutions)
      .set({
        status: "running",
        attemptCount: existing.attemptCount + 1,
        startedAt: nowIso,
        completedAt: null,
        error: null,
        updatedAt: nowIso,
      })
      .where(eq(monitoringScheduleExecutions.id, existing.id))
      .run();
    return { id: existing.id, attemptCount: existing.attemptCount + 1 };
  }

  try {
    const inserted = database
      .insert(monitoringScheduleExecutions)
      .values({
        jobId,
        scheduleKey,
        status: "running",
        attemptCount: 1,
        startedAt: nowIso,
        createdAt: nowIso,
        updatedAt: nowIso,
      })
      .returning({ id: monitoringScheduleExecutions.id })
      .get();
    return { id: inserted.id, attemptCount: 1 };
  } catch {
    // A concurrent scheduler invocation won the unique job/date claim.
    return null;
  }
}

function finishExecution(
  database: DatabaseClient,
  executionId: number,
  completedAt: string,
  runId: number,
): void {
  database
    .update(monitoringScheduleExecutions)
    .set({ status: "completed", completedAt, runId, error: null, updatedAt: completedAt })
    .where(eq(monitoringScheduleExecutions.id, executionId))
    .run();
}

function failExecution(
  database: DatabaseClient,
  executionId: number,
  failedAt: string,
  error: unknown,
  runId?: number,
): void {
  database
    .update(monitoringScheduleExecutions)
    .set({
      status: "failed",
      completedAt: failedAt,
      ...(runId !== undefined ? { runId } : {}),
      error: messageOf(error),
      updatedAt: failedAt,
    })
    .where(eq(monitoringScheduleExecutions.id, executionId))
    .run();
}

async function readErrorResponse(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 1_000);
  } catch {
    return "";
  }
}

async function fetchSourceSnapshot(
  config: MonitoringSchedulerConfig,
  job: { id: number; name: string },
  scheduleKey: string,
  fetchImpl: typeof fetch,
  requestedAt: Date,
): Promise<z.infer<typeof sourceSnapshotSchema>> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (config.sourceToken) headers.Authorization = `Bearer ${config.sourceToken}`;

  const response = await fetchImpl(config.sourceUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jobId: job.id,
      jobName: job.name,
      scheduleKey,
      requestedAt: requestedAt.toISOString(),
    }),
    signal: AbortSignal.timeout(config.sourceTimeoutMs ?? DEFAULT_SOURCE_TIMEOUT_MS),
  });
  if (!response.ok) {
    const details = await readErrorResponse(response);
    throw new Error(`source adapter returned ${response.status}${details ? `: ${details}` : ""}`);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error("source adapter returned invalid JSON");
  }
  const parsed = sourceSnapshotSchema.safeParse(body);
  if (!parsed.success) {
    throw new Error(`source adapter returned an invalid complete snapshot: ${parsed.error.message}`);
  }
  return parsed.data;
}

function parseCandidate(details: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(details);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function emailContent(
  job: { id: number; name: string },
  alert: AlertRow,
  runId: number,
  publicUrl?: string,
): { subject: string; text: string; html: string } {
  const candidate = parseCandidate(alert.details);
  const message = typeof candidate.message === "string" ? candidate.message : alert.title;
  const currentValue = typeof candidate.currentValue === "number" ? candidate.currentValue : null;
  const threshold = typeof candidate.threshold === "number" ? candidate.threshold : null;
  const referenceValue = typeof candidate.referenceValue === "number" ? candidate.referenceValue : null;
  const prefix = alert.severity === "critical" ? "[Critical]" : "[Warning]";
  const subject = `${prefix} ${alert.title} — ${job.name}`;
  const lines = [
    `Monitoring job: ${job.name} (#${job.id})`,
    `Alert: ${alert.title}`,
    `Severity: ${alert.severity}`,
    `Message: ${message}`,
    `Occurrence: ${alert.occurrenceCount}`,
    `Run: ${runId}`,
    ...(currentValue === null ? [] : [`Current value: ${currentValue}`]),
    ...(threshold === null ? [] : [`Threshold: ${threshold}`]),
    ...(referenceValue === null ? [] : [`Reference value: ${referenceValue}`]),
    ...(alert.lastTriggeredAt ? [`Triggered at: ${alert.lastTriggeredAt}`] : []),
    "",
    "EntitleGuard is read-only. Review the incident and assign an owner; it will not change access automatically.",
    ...(publicUrl ? [`Operator base URL: ${publicUrl.replace(/\/$/, "")}`] : []),
  ];
  const text = lines.join("\n");
  const html = `<h2>${escapeHtml(subject)}</h2><p>${escapeHtml(message)}</p><ul>${lines
    .filter((line) => line && !line.startsWith("EntitleGuard") && !line.startsWith("Operator base"))
    .map((line) => `<li>${escapeHtml(line)}</li>`)
    .join("")}</ul><p>EntitleGuard is read-only. Review the incident and assign an owner; it will not change access automatically.</p>${
    publicUrl
      ? `<p>Operator base URL: <a href="${escapeHtml(publicUrl.replace(/\/$/, ""))}">${escapeHtml(
          publicUrl.replace(/\/$/, ""),
        )}</a></p>`
      : ""
  }`;
  return { subject, text, html };
}

async function sendConfiguredEmail(
  config: MonitoringSchedulerConfig,
  message: OutboundAlertEmail,
  fetchImpl: typeof fetch,
): Promise<{ id?: string }> {
  if (config.smtp) {
    const transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure ?? config.smtp.port === 465,
      auth: { user: config.smtp.user, pass: config.smtp.pass },
    });
    const result = await transporter.sendMail(message);
    return { id: result.messageId };
  }

  const response = await fetchImpl(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(message),
    signal: AbortSignal.timeout(config.emailTimeoutMs ?? DEFAULT_EMAIL_TIMEOUT_MS),
  });
  if (!response.ok) {
    const details = await readErrorResponse(response);
    throw new Error(`email provider returned ${response.status}${details ? `: ${details}` : ""}`);
  }

  try {
    const responseBody = (await response.json()) as { id?: unknown };
    return { id: typeof responseBody.id === "string" ? responseBody.id : undefined };
  } catch {
    return {};
  }
}

async function deliverEmail(
  database: DatabaseClient,
  config: MonitoringSchedulerConfig,
  job: { id: number; name: string },
  alert: AlertRow,
  runId: number,
  fetchImpl: typeof fetch,
  now: Date,
  sendEmailImpl?: (message: OutboundAlertEmail) => Promise<{ id?: string }>,
): Promise<boolean> {
  const recipient = [...config.alertTo].sort().join(",");
  const existing = database
    .select()
    .from(monitoringAlertNotifications)
    .where(
      and(
        eq(monitoringAlertNotifications.alertId, alert.id),
        eq(monitoringAlertNotifications.runId, runId),
        eq(monitoringAlertNotifications.channel, "email"),
        eq(monitoringAlertNotifications.recipient, recipient),
      ),
    )
    .get();
  if (existing?.status === "delivered") return false;

  const nowIso = now.toISOString();
  let notificationId: number;
  if (existing) {
    notificationId = existing.id;
    database
      .update(monitoringAlertNotifications)
      .set({
        status: "pending",
        attemptCount: existing.attemptCount + 1,
        error: null,
        updatedAt: nowIso,
      })
      .where(eq(monitoringAlertNotifications.id, existing.id))
      .run();
  } else {
    notificationId = database
      .insert(monitoringAlertNotifications)
      .values({
        alertId: alert.id,
        runId,
        channel: "email",
        recipient,
        status: "pending",
        attemptCount: 1,
        createdAt: nowIso,
        updatedAt: nowIso,
      })
      .returning({ id: monitoringAlertNotifications.id })
      .get().id;
  }

  const content = emailContent(job, alert, runId, config.publicUrl);
  try {
    const message: OutboundAlertEmail = {
      from: config.alertFrom,
      to: config.alertTo,
      subject: content.subject,
      text: content.text,
      html: content.html,
    };
    const providerResult = await (sendEmailImpl
      ? sendEmailImpl(message)
      : sendConfiguredEmail(config, message, fetchImpl));
    const deliveredAt = new Date().toISOString();
    database
      .update(monitoringAlertNotifications)
      .set({
        status: "delivered",
        providerMessageId: providerResult.id ?? null,
        error: null,
        deliveredAt,
        updatedAt: deliveredAt,
      })
      .where(eq(monitoringAlertNotifications.id, notificationId))
      .run();
    return true;
  } catch (error) {
    const failedAt = new Date().toISOString();
    database
      .update(monitoringAlertNotifications)
      .set({ status: "failed", error: messageOf(error), updatedAt: failedAt })
      .where(eq(monitoringAlertNotifications.id, notificationId))
      .run();
    throw error;
  }
}

async function deliverTriggeredAlerts(
  database: DatabaseClient,
  config: MonitoringSchedulerConfig,
  job: { id: number; name: string },
  runId: number,
  fetchImpl: typeof fetch,
  now: Date,
  sendEmailImpl?: (message: OutboundAlertEmail) => Promise<{ id?: string }>,
): Promise<number> {
  const triggeredAlerts = database
    .select({
      id: monitoringAlerts.id,
      type: monitoringAlerts.type,
      severity: monitoringAlerts.severity,
      status: monitoringAlerts.status,
      title: monitoringAlerts.title,
      details: monitoringAlerts.details,
      occurrenceCount: monitoringAlerts.occurrenceCount,
      lastTriggeredAt: monitoringAlerts.lastTriggeredAt,
    })
    .from(monitoringAlerts)
    .where(
      and(
        eq(monitoringAlerts.jobId, job.id),
        eq(monitoringAlerts.lastRunId, runId),
        eq(monitoringAlerts.status, "open"),
      ),
    )
    .all();

  let delivered = 0;
  for (const alert of triggeredAlerts) {
    // Critical paid-but-blocked incidents repeat nightly until acknowledged.
    // Warning incidents send once when first opened to avoid dashboard-by-email noise.
    if (alert.type !== "paid_blocked" && alert.occurrenceCount > 1) continue;
    if (await deliverEmail(database, config, job, alert, runId, fetchImpl, now, sendEmailImpl)) {
      delivered += 1;
    }
  }
  return delivered;
}

async function runClaimedJob(
  database: DatabaseClient,
  config: MonitoringSchedulerConfig,
  job: { id: number; name: string },
  scheduleKey: string,
  execution: ClaimedExecution,
  fetchImpl: typeof fetch,
  now: Date,
  sendEmailImpl?: (message: OutboundAlertEmail) => Promise<{ id?: string }>,
): Promise<MonitoringScheduledJobResult> {
  let runId: number | undefined;
  try {
    const requestedAt = new Date();
    const snapshot = await fetchSourceSnapshot(config, job, scheduleKey, fetchImpl, requestedAt);
    const completedAt = snapshot.completedAt ?? new Date().toISOString();
    const result = ingestMonitoringRun(
      {
        jobId: job.id,
        idempotencyKey: `nightly:${scheduleKey}`,
        source: "scheduled",
        completeSnapshot: true,
        startedAt: snapshot.startedAt ?? requestedAt.toISOString(),
        completedAt,
        totalAppRecords: snapshot.totalAppRecords,
        totalStripeRecords: snapshot.totalStripeRecords,
        findings: snapshot.findings,
      },
      database,
    );
    runId = result.runId;
    const alertsDelivered = await deliverTriggeredAlerts(
      database,
      config,
      job,
      result.runId,
      fetchImpl,
      now,
      sendEmailImpl,
    );
    finishExecution(database, execution.id, new Date().toISOString(), result.runId);
    return { jobId: job.id, jobName: job.name, status: "completed", runId, alertsDelivered };
  } catch (error) {
    failExecution(database, execution.id, new Date().toISOString(), error, runId);
    return {
      jobId: job.id,
      jobName: job.name,
      status: "failed",
      ...(runId === undefined ? {} : { runId }),
      reason: messageOf(error),
    };
  }
}

/**
 * Run every active nightly job once for the current UTC date.
 *
 * The hosting platform remains responsible for invoking this function nightly;
 * this module provides claiming, source acquisition, ingestion, and email delivery.
 */
export async function runNightlyMonitoring(
  config: MonitoringSchedulerConfig,
  database: DatabaseClient = defaultDb,
  dependencies: SchedulerDependencies = {},
): Promise<MonitoringSchedulerResult> {
  assertConfig(config);
  const now = dependencies.now ?? new Date();
  const fetchImpl = dependencies.fetch ?? fetch;
  const scheduleKey = utcScheduleKey(now);
  const startedAt = new Date().toISOString();
  const jobs = database
    .select({ id: monitoringJobs.id, name: monitoringJobs.name })
    .from(monitoringJobs)
    .where(and(eq(monitoringJobs.status, "active"), eq(monitoringJobs.schedule, "nightly")))
    .all();

  const results: MonitoringScheduledJobResult[] = [];
  for (const job of jobs) {
    const execution = claimExecution(database, job.id, scheduleKey, now);
    if (!execution) {
      results.push({
        jobId: job.id,
        jobName: job.name,
        status: "skipped",
        reason: "already completed or currently running for this UTC date",
      });
      continue;
    }
    results.push(
      await runClaimedJob(
        database,
        config,
        job,
        scheduleKey,
        execution,
        fetchImpl,
        now,
        dependencies.sendEmail,
      ),
    );
  }

  return {
    scheduleKey,
    startedAt,
    completedAt: new Date().toISOString(),
    jobs: results,
    completed: results.filter((result) => result.status === "completed").length,
    skipped: results.filter((result) => result.status === "skipped").length,
    failed: results.filter((result) => result.status === "failed").length,
  };
}