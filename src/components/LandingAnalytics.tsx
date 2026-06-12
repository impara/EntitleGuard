"use client";

import { useEffect } from "react";
import { track } from "@/lib/analytics";

export function LandingAnalytics() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ref = params.get("ref");
    const referrer = document.referrer ? document.referrer.slice(0, 256) : "";
    track("landing_page_viewed", {
      ...(ref ? { ref: ref.slice(0, 64) } : {}),
      ...(referrer ? { referrer } : {}),
    });
  }, []);
  return null;
}
