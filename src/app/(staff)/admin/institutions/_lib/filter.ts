// Which institutions the staff queue shows, from `?status=`: one status,
// or `all`. It opens on the registrations waiting to be checked.

import { APP_ROUTES } from "@/lib/app-routes";
import {
  INSTITUTION_STATUSES,
  type InstitutionStatus,
} from "@/server/modules/institutions";

export type StatusFilter = InstitutionStatus | "all";

/** The filter tabs, in the order staff meet them. */
export const STATUS_FILTERS: readonly StatusFilter[] = [
  ...INSTITUTION_STATUSES,
  "all",
];

const DEFAULT: StatusFilter = "pending_verification";

export function statusFilter(
  param: string | string[] | undefined
): StatusFilter {
  const value = Array.isArray(param) ? param[0] : param;
  return (STATUS_FILTERS as readonly string[]).includes(value ?? "")
    ? (value as StatusFilter)
    : DEFAULT;
}

export function filterHref(filter: StatusFilter): string {
  return filter === DEFAULT
    ? APP_ROUTES.adminInstitutions
    : `${APP_ROUTES.adminInstitutions}?status=${filter}`;
}
