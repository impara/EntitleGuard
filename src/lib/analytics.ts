"use client";

import type { AnalyticsEvent } from "./analytics-shared";

/**
 * Minimal client-side tracker (FR10). Sends event name + scalar props only —
 * structurally incapable of shipping CSV rows. Failures are swallowed: the
 * audit must work even if analytics is blocked.
 */

const SESSION_KEY = "eg_session_id";

export function getSessionId(): string {
  if (typeof window === "undefined") return "server";
  let id = window.sessionStorage.getItem(SESSION_KEY);
  if (!id) {
    id = crypto.randomUUID();
    window.sessionStorage.setItem(SESSION_KEY, id);
  }
  return id;
}

export function track(
  name: AnalyticsEvent,
  props?: Record<string, string | number | boolean>,
): void {
  if (typeof window === "undefined") return;
  const payload = JSON.stringify({ sessionId: getSessionId(), name, props });
  try {
    if (navigator.sendBeacon) {
      navigator.sendBeacon(
        "/api/events",
        new Blob([payload], { type: "application/json" }),
      );
    } else {
      void fetch("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
        keepalive: true,
      });
    }
  } catch {
    // analytics must never break the product
  }
}
