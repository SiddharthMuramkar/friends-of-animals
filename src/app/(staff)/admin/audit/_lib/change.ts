// An audit entry's before and after, ready to show: a role change as the
// grants held before and after (and which were added or removed), and
// anything else as indented JSON.

import { z } from "zod";

import type { Grant } from "@/server/access";
import { grantKey, grantSchema } from "@/server/access/domain/roles";

export type ChangeView =
  | {
      kind: "grants";
      before: Grant[];
      after: Grant[];
      added: Grant[];
      removed: Grant[];
    }
  | { kind: "json"; before: string | null; after: string | null };

const grantList = z.array(grantSchema);

/** The grants in `list` that `other` doesn't hold. */
function missingFrom(list: Grant[], other: Grant[]): Grant[] {
  const keys = new Set(other.map(grantKey));
  return list.filter((grant) => !keys.has(grantKey(grant)));
}

function json(value: unknown): string | null {
  return value === null || value === undefined
    ? null
    : JSON.stringify(value, null, 2);
}

export function describeChange(before: unknown, after: unknown): ChangeView {
  const grantsBefore = grantList.safeParse(before);
  const grantsAfter = grantList.safeParse(after);
  if (grantsBefore.success && grantsAfter.success) {
    const [was, is] = [grantsBefore.data, grantsAfter.data];
    return {
      kind: "grants",
      before: was,
      after: is,
      added: missingFrom(is, was),
      removed: missingFrom(was, is),
    };
  }
  return { kind: "json", before: json(before), after: json(after) };
}
