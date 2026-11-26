// Donor PANs are collected only while the 80G organisation fact is on.
// Shape validation, not verification with the tax authority (HR-16/47).
export function normalizePan(raw?: string | null): string | null {
  const pan = raw?.trim().toUpperCase();
  return pan && /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan) ? pan : null;
}

/** A receipt identifies the saved PAN without storing it in plain text. */
export function maskPan(pan: string): string {
  return `******${pan.slice(-4)}`;
}
