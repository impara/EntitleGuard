"use client";

import { useState } from "react";
import { LeadCaptureModal } from "@/components/audit/LeadCaptureModal";
import { track } from "@/lib/analytics";

interface MonitoringBetaButtonProps {
  className: string;
  source: "hero" | "monitoring_section" | "final_cta";
  children?: React.ReactNode;
}

export function MonitoringBetaButton({ className, source, children }: MonitoringBetaButtonProps) {
  const [open, setOpen] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  return (
    <>
      <button
        type="button"
        className={className}
        onClick={() => {
          track("monitoring_cta_clicked", { source });
          setOpen(true);
        }}
      >
        {submitted ? "Monitoring beta application received" : children}
      </button>
      {open && (
        <LeadCaptureModal
          requestType="monitoring_beta"
          onClose={() => setOpen(false)}
          onSuccess={() => {
            setSubmitted(true);
            setOpen(false);
          }}
        />
      )}
    </>
  );
}
