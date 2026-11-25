// Which listings the staff queue shows, from `?status=` and `?after=`: one
// status at a time, opening on the listings waiting to be checked, one
// page at a time.

import { ADMIN_DIRECTORY } from "@/lib/app-routes";
import {
  LISTING_STATUSES,
  type ListingStatus,
} from "@/server/modules/directory";

const DEFAULT: ListingStatus = "pending_verification";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function first(param: string | string[] | undefined): string | undefined {
  return Array.isArray(param) ? param[0] : param;
}

export function statusFilter(
  param: string | string[] | undefined
): ListingStatus {
  const value = first(param);
  return (LISTING_STATUSES as readonly string[]).includes(value ?? "")
    ? (value as ListingStatus)
    : DEFAULT;
}

/** The page cursor, if it looks like a listing id. */
export function afterFilter(
  param: string | string[] | undefined
): string | undefined {
  const value = first(param);
  return value && UUID.test(value) ? value : undefined;
}

export function filterHref(status: ListingStatus, after?: string): string {
  const query = new URLSearchParams();
  if (status !== DEFAULT) query.set("status", status);
  if (after) query.set("after", after);
  const search = query.toString();
  return search ? `${ADMIN_DIRECTORY}?${search}` : ADMIN_DIRECTORY;
}
