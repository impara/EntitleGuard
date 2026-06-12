"use client";

import type { ProgressUpdate } from "@/lib/engine";

const PHASE_LABELS: Record<ProgressUpdate["phase"], string> = {
  normalizing: "Normalizing statuses and identifiers…",
  matching: "Matching Stripe customers to app accounts…",
  classifying: "Classifying mismatches…",
  estimating: "Estimating exposure…",
  done: "Finishing up…",
};

export function ProgressState({ progress }: { progress: ProgressUpdate | null }) {
  const fraction = progress?.fraction ?? 0.05;
  const label = progress ? PHASE_LABELS[progress.phase] : "Preparing audit…";

  return (
    <div className="mx-auto max-w-md py-20 text-center">
      <div className="mx-auto mb-6 h-2 w-full overflow-hidden rounded-full bg-surface">
        <div
          className="h-full rounded-full bg-accent transition-all duration-300"
          style={{ width: `${Math.max(5, Math.round(fraction * 100))}%` }}
        />
      </div>
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-2 text-xs text-muted">
        Everything runs locally in your browser — nothing is uploaded.
      </p>
    </div>
  );
}
