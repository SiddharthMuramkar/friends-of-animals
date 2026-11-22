// The audit page's filters live in its URL, so a search is a plain GET
// form, a filtered view can be shared, and "Older entries" keeps the
// filters with no client state.

import { APP_ROUTES } from "@/lib/app-routes";
import type { SearchAuditLogInput } from "@/server/audit";

import { firstParam, type SearchParams } from "../../_lib/search-params";

export type AuditField = "person" | "entityType" | "action";

/** The form's fields, the page's cursor and its size, all from the URL. */
export type AuditFilters = Partial<
  Record<AuditField | "cursor" | "limit", string>
>;

/** In URL order. */
const PARAMS = ["person", "entityType", "action", "cursor", "limit"] as const;

const FIELDS: readonly string[] = ["person", "entityType", "action"];

export function readAuditFilters(searchParams: SearchParams): AuditFilters {
  const filters: AuditFilters = {};
  for (const name of PARAMS) {
    const value = firstParam(searchParams, name);
    if (value) filters[name] = value;
  }
  return filters;
}

export function auditHref(filters: AuditFilters): string {
  const query = new URLSearchParams();
  for (const name of PARAMS) {
    const value = filters[name];
    if (value) query.set(name, value);
  }
  const search = query.toString();
  return search ? `${APP_ROUTES.adminAudit}?${search}` : APP_ROUTES.adminAudit;
}

/** The filters as the search takes them; it checks every value. */
export function searchInput(filters: AuditFilters): SearchAuditLogInput {
  const { limit, ...rest } = filters;
  return limit === undefined ? rest : { ...rest, limit: Number(limit) };
}

/**
 * The form fields an invalid search names, and whether the page link (the
 * cursor or size, which only links write) was broken.
 */
export function fieldsAtFault(fields: readonly string[]): {
  fields: AuditField[];
  badPage: boolean;
} {
  return {
    fields: fields.filter((name): name is AuditField => FIELDS.includes(name)),
    badPage: fields.includes("cursor") || fields.includes("limit"),
  };
}
