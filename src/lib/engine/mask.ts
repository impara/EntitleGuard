/** Masking utilities (FR7): never render full identifiers in the UI/report. */

export function maskEmail(email: string | null): string | null {
  if (!email) return null;
  const trimmed = email.trim();
  const at = trimmed.indexOf("@");
  if (at <= 0) return "***";
  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  const visible = local.slice(0, 1);
  return `${visible}***@${domain}`;
}

/** "cus_9XKd72bQ4f" -> "cus_9X…4f"; short ids -> "…" padded. */
export function maskId(id: string | null): string | null {
  if (!id) return null;
  const trimmed = id.trim();
  if (trimmed.length <= 6) {
    return `${trimmed.slice(0, 2)}…`;
  }
  return `${trimmed.slice(0, 6)}…${trimmed.slice(-2)}`;
}
