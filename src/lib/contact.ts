/** How a contact fact is reached: by email or by phone. */
export type ContactKind = "email" | "phone";

/**
 * The mailto: or tel: href for a contact value. Phone numbers keep only
 * digits and a leading +, so "+91 98765 43210" dials as +919876543210.
 */
export function contactHref(kind: ContactKind, value: string): string {
  if (kind === "email") return `mailto:${value.trim()}`;
  const digits = value.replace(/[^\d+]/g, "");
  return `tel:${digits.startsWith("+") ? "+" : ""}${digits.replace(/\+/g, "")}`;
}
