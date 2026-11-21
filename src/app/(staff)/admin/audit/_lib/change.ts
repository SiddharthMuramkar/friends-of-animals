// An audit entry's before and after, ready to show: a role change as the
// grants held before and after (and which were added or removed), and
// anything else as indented JSON.

import type { Grant } from "@/server/access";

export type ChangeView =
  | {
      kind: "grants";
      before: Grant[];
      after: Grant[];
      added: Grant[];
      removed: Grant[];
    }
  | { kind: "json"; before: string | null; after: string | null };

export function describeChange(_before: unknown, _after: unknown): ChangeView {
  throw new Error("Not implemented");
}
