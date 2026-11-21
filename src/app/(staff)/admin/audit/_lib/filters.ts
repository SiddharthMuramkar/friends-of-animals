// The audit page's filters live in its URL, so a search is a plain GET
// form, a filtered view can be shared, and "Older entries" keeps the
// filters with no client state.

export type AuditField = "person" | "entityType" | "action";

export type AuditFilters = Partial<Record<AuditField | "cursor", string>>;

type SearchParams = Record<string, string | string[] | undefined>;

export function readAuditFilters(_searchParams: SearchParams): AuditFilters {
  throw new Error("Not implemented");
}

export function auditHref(_filters: AuditFilters): string {
  throw new Error("Not implemented");
}

export function fieldsAtFault(_fields: readonly string[]): {
  fields: AuditField[];
  badPage: boolean;
} {
  throw new Error("Not implemented");
}
