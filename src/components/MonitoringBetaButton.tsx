"use client";

import { useState } from "react";
import { LeadCaptureModal } from "@/components/audit/LeadCaptureModal";

interface MonitoringBetaButtonProps {
  className: string;
  children?: React.ReactNode;
}

export function MonitoringBetaButton({ className, children }: MonitoringBetaButtonProps) {
  const [open, setOpen] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  return (
    <>
      <button
        type="button"
        className={className}
        onClick={() => setOpen(true)}
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
