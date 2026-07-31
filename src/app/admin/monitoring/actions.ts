"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  MonitoringAlertActionError,
  transitionMonitoringAlert,
  type MonitoringAlertAction,
} from "@/lib/monitoring/alert-actions";

function requiredPositiveInteger(formData: FormData, field: string): number {
  const value = Number(formData.get(field));
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive integer`);
  }
  return value;
}

function operatorActor(): string {
  return process.env.MONITORING_OPERATOR_NAME?.trim() || "admin";
}

function messageUrl(kind: "updated" | "error", message: string, jobId?: number): string {
  const anchor = jobId ? `#job-${jobId}` : "";
  return `/admin/monitoring?${kind}=${encodeURIComponent(message)}${anchor}`;
}

async function transitionFromForm(action: MonitoringAlertAction, formData: FormData) {
  let jobId: number | undefined;
  try {
    const alertId = requiredPositiveInteger(formData, "alertId");
    jobId = requiredPositiveInteger(formData, "jobId");
    const noteValue = formData.get("note");
    const note = typeof noteValue === "string" ? noteValue : null;

    transitionMonitoringAlert(alertId, {
      action,
      actor: operatorActor(),
      note,
    });
  } catch (error) {
    const message =
      error instanceof MonitoringAlertActionError || error instanceof Error
        ? error.message
        : "Alert action failed";
    redirect(messageUrl("error", message, jobId));
  }

  revalidatePath("/admin/monitoring");
  redirect(
    messageUrl(
      "updated",
      action === "acknowledge" ? "Alert acknowledged" : "Alert resolved",
      jobId,
    ),
  );
}

export async function acknowledgeAlert(formData: FormData) {
  await transitionFromForm("acknowledge", formData);
}

export async function resolveAlert(formData: FormData) {
  await transitionFromForm("resolve", formData);
}
