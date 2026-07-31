import { desc, eq } from "drizzle-orm";
import {
  db as defaultDb,
  monitoringAlerts,
  type DatabaseClient,
} from "../../db";
import type {
  MonitoringAlertSeverity,
  MonitoringAlertStatus,
  MonitoringAlertType,
} from "./types";

export type MonitoringAlertAction = "acknowledge" | "resolve";

export interface MonitoringAlertActionInput {
  action: MonitoringAlertAction;
  actor: string;
  note?: string | null;
  now?: string | Date;
}

export interface MonitoringAlertRecordView {
  id: number;
  jobId: number;
  type: MonitoringAlertType;
  severity: MonitoringAlertSeverity;
  status: MonitoringAlertStatus;
  title: string;
  details: Record<string, unknown> | null;
  occurrenceCount: number;
  firstTriggeredAt: string | null;
  lastTriggeredAt: string | null;
  acknowledgedBy: string | null;
  acknowledgedAt: string | null;
  acknowledgementNote: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
  resolutionNote: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MonitoringAlertActionResult {
  idempotent: boolean;
  alert: MonitoringAlertRecordView;
}

export type MonitoringAlertActionErrorCode =
  | "ALERT_NOT_FOUND"
  | "INVALID_ALERT"
  | "INVALID_TRANSITION";

export class MonitoringAlertActionError extends Error {
  constructor(
    public readonly code: MonitoringAlertActionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "MonitoringAlertActionError";
  }
}

function parseDetails(value: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function rowToView(row: typeof monitoringAlerts.$inferSelect): MonitoringAlertRecordView {
  return {
    id: row.id,
    jobId: row.jobId,
    type: row.type as MonitoringAlertType,
    severity: row.severity as MonitoringAlertSeverity,
    status: row.status as MonitoringAlertStatus,
    title: row.title,
    details: parseDetails(row.details),
    occurrenceCount: row.occurrenceCount,
    firstTriggeredAt: row.firstTriggeredAt,
    lastTriggeredAt: row.lastTriggeredAt,
    acknowledgedBy: row.acknowledgedBy,
    acknowledgedAt: row.acknowledgedAt,
    acknowledgementNote: row.acknowledgementNote,
    resolvedBy: row.resolvedBy,
    resolvedAt: row.resolvedAt,
    resolutionNote: row.resolutionNote,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function validateInput(alertId: number, input: MonitoringAlertActionInput): {
  actor: string;
  note: string | null;
  now: string;
} {
  if (!Number.isInteger(alertId) || alertId <= 0) {
    throw new MonitoringAlertActionError("INVALID_ALERT", "alertId must be a positive integer");
  }
  if (input.action !== "acknowledge" && input.action !== "resolve") {
    throw new MonitoringAlertActionError("INVALID_ALERT", "unsupported alert action");
  }

  const actor = input.actor.trim();
  if (!actor || actor.length > 200) {
    throw new MonitoringAlertActionError(
      "INVALID_ALERT",
      "actor must be between 1 and 200 characters",
    );
  }

  const note = input.note?.trim() || null;
  if (note && note.length > 1_000) {
    throw new MonitoringAlertActionError("INVALID_ALERT", "note cannot exceed 1000 characters");
  }

  const date = input.now instanceof Date ? input.now : new Date(input.now ?? Date.now());
  if (Number.isNaN(date.getTime())) {
    throw new MonitoringAlertActionError("INVALID_ALERT", "now must be a valid timestamp");
  }

  return { actor, note, now: date.toISOString() };
}

export function transitionMonitoringAlert(
  alertId: number,
  input: MonitoringAlertActionInput,
  database: DatabaseClient = defaultDb,
): MonitoringAlertActionResult {
  const normalized = validateInput(alertId, input);
  const existing = database
    .select()
    .from(monitoringAlerts)
    .where(eq(monitoringAlerts.id, alertId))
    .get();

  if (!existing) {
    throw new MonitoringAlertActionError(
      "ALERT_NOT_FOUND",
      `monitoring alert ${alertId} was not found`,
    );
  }

  if (input.action === "acknowledge") {
    if (existing.status === "resolved") {
      throw new MonitoringAlertActionError(
        "INVALID_TRANSITION",
        "a resolved alert cannot be acknowledged",
      );
    }
    if (existing.status === "acknowledged") {
      return { idempotent: true, alert: rowToView(existing) };
    }

    const updated = database
      .update(monitoringAlerts)
      .set({
        status: "acknowledged",
        acknowledgedBy: normalized.actor,
        acknowledgedAt: normalized.now,
        acknowledgementNote: normalized.note,
        updatedAt: normalized.now,
      })
      .where(eq(monitoringAlerts.id, alertId))
      .returning()
      .get();

    return { idempotent: false, alert: rowToView(updated) };
  }

  if (existing.status === "resolved") {
    return { idempotent: true, alert: rowToView(existing) };
  }

  const updated = database
    .update(monitoringAlerts)
    .set({
      status: "resolved",
      resolvedBy: normalized.actor,
      resolvedAt: normalized.now,
      resolutionNote: normalized.note,
      updatedAt: normalized.now,
    })
    .where(eq(monitoringAlerts.id, alertId))
    .returning()
    .get();

  return { idempotent: false, alert: rowToView(updated) };
}

export function listRecentMonitoringAlerts(
  jobId: number,
  database: DatabaseClient = defaultDb,
  limit = 50,
): MonitoringAlertRecordView[] {
  if (!Number.isInteger(jobId) || jobId <= 0) {
    throw new MonitoringAlertActionError("INVALID_ALERT", "jobId must be a positive integer");
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new MonitoringAlertActionError("INVALID_ALERT", "limit must be between 1 and 100");
  }

  return database
    .select()
    .from(monitoringAlerts)
    .where(eq(monitoringAlerts.jobId, jobId))
    .orderBy(desc(monitoringAlerts.createdAt))
    .limit(limit)
    .all()
    .map(rowToView);
}
