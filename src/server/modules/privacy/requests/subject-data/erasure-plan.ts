// What an erasure does with each kind of record (#115b). The officer
// previews this plan, approves it by its fingerprint, and the worker
// carries out the same plan or nothing.
//
// Every kind of record is deleted, anonymised, kept, or (consents)
// withdrawn:
//
// - Consents still given are withdrawn, always, even under a legal hold.
// - The consent log, signed forms and code links stay as proof of what was
//   consented to (consent_proof), and the audit log stays: it is
//   append-only and only the database owner can change it (HR-30).
// - Payments stay under their 8-year floor (financial_floor), and so do
//   the registrations they paid for (financial_record), with their profile
//   anonymised rather than deleted.
// - The account stays, with nothing but its name and contact, while the
//   law needs it: a payment it made is under its floor (when the setting
//   privacy.erasureKeepsPayerAccount says so), or a record that can't lose
//   it names it (an institution it registered, consent evidence it handled,
//   an upload another record keeps).
// - A guardian's children are their own people: their records stay until
//   someone files an erasure for them.
// - A legal hold keeps everything (but still withdraws consents).
//
// The fingerprint covers every kind's action and basis, whether the person
// has any of it or not, never counts, ids or dates: a message delivered
// between preview and run doesn't change it, but a new payment (which
// keeps the account) or a legal hold does.
//
// Pure, and loads under plain Node.

import { createHash } from "node:crypto";

export type ErasureAction = "withdraw" | "delete" | "anonymise" | "retain";

export type RetentionBasis =
  | "financial_floor"
  | "financial_record"
  | "consent_proof"
  | "audit_log"
  | "legal_hold"
  | "linked_records"
  | "institution_record"
  | "separate_subject"
  | "rights_record";

export const ERASURE_CATEGORIES = [
  "consents",
  "sign_in",
  "roles",
  "messages",
  "guardian_record",
  "uploads",
  "entries",
  "registrations",
  "guardian_links",
  "profile",
  "account",
  "kept_profile",
  "paid_registrations",
  "payments",
  "children",
  "consent_records",
  "audit_log",
  "privacy_requests",
] as const;

export type ErasureCategoryKey = (typeof ERASURE_CATEGORIES)[number];

export type ErasureCategory = {
  key: ErasureCategoryKey;
  action: ErasureAction;
  basis: RetentionBasis | null;
  /** When the basis lapses; null when it has no end date. */
  until: Date | null;
  count: number;
};

/** Why the account must stay, if it must. */
export type AccountKeeper = {
  basis:
    | "financial_floor"
    | "linked_records"
    | "consent_proof"
    | "institution_record";
  until: Date | null;
};

/** How many records of each kind the person has, and what binds them. */
export type ErasureFacts = {
  onLegalHold: boolean;
  givenConsents: number;
  accounts: number;
  /** Null when every account in scope can go. */
  accountKeeper: AccountKeeper | null;
  signIn: number;
  roles: number;
  messages: number;
  guardianRecords: number;
  uploads: number;
  entries: number;
  freeRegistrations: number;
  keptRegistrations: number;
  guardianLinks: number;
  deletableProfiles: number;
  keptProfiles: number;
  keptProfileBasis: "financial_record" | "consent_proof";
  payments: number;
  paymentsUntil: Date | null;
  children: number;
  consentRecords: number;
  auditEntries: number;
  privacyRequests: number;
};

export type ErasurePlan = {
  categories: ErasureCategory[];
  outcome: "completed" | "partially_completed";
  fingerprint: string;
};

function category(
  key: ErasureCategoryKey,
  action: ErasureAction,
  count: number,
  basis: RetentionBasis | null = null,
  until: Date | null = null
): ErasureCategory {
  return { key, action, basis, until, count };
}

export function planErasure(facts: ErasureFacts): ErasurePlan {
  const kept = facts.accountKeeper;
  const planned: ErasureCategory[] = [
    category("consents", "withdraw", facts.givenConsents),
    category("sign_in", "delete", facts.signIn),
    category("roles", "delete", facts.roles),
    category("messages", "delete", facts.messages),
    category("guardian_record", "delete", facts.guardianRecords),
    category("uploads", "delete", facts.uploads),
    category("entries", "delete", facts.entries),
    category("registrations", "delete", facts.freeRegistrations),
    category("guardian_links", "delete", facts.guardianLinks),
    category("profile", "delete", facts.deletableProfiles),
    kept
      ? category("account", "retain", facts.accounts, kept.basis, kept.until)
      : category("account", "delete", facts.accounts),
    category(
      "kept_profile",
      "anonymise",
      facts.keptProfiles,
      facts.keptProfileBasis
    ),
    category(
      "paid_registrations",
      "retain",
      facts.keptRegistrations,
      "financial_record"
    ),
    category(
      "payments",
      "retain",
      facts.payments,
      "financial_floor",
      facts.paymentsUntil
    ),
    category("children", "retain", facts.children, "separate_subject"),
    category(
      "consent_records",
      "retain",
      facts.consentRecords,
      "consent_proof"
    ),
    category("audit_log", "retain", facts.auditEntries, "audit_log"),
    category(
      "privacy_requests",
      "retain",
      facts.privacyRequests,
      "rights_record"
    ),
  ];
  // Under a legal hold everything stays; consents are still withdrawn.
  const decided = planned.map((each) =>
    facts.onLegalHold && each.action !== "withdraw"
      ? {
          ...each,
          action: "retain" as const,
          basis: "legal_hold" as const,
          until: null,
        }
      : each
  );
  const categories = decided.filter((each) => each.count > 0);
  const outcome = categories.some((each) => each.action === "retain")
    ? "partially_completed"
    : "completed";
  // Every kind's decision, present or not: a record appearing between the
  // preview and the run (a message delivered) doesn't change the plan.
  return { categories, outcome, fingerprint: fingerprintOf(decided) };
}

/** A hash of each kind's action and basis: what the officer approved. */
export function fingerprintOf(categories: readonly ErasureCategory[]): string {
  const decisions = categories.map((each) => [
    each.key,
    each.action,
    each.basis,
  ]);
  return createHash("sha256")
    .update(JSON.stringify(decisions))
    .digest("hex")
    .slice(0, 32);
}

/** The kept kinds, as the request records them for the requester. */
export function retainedCategories(plan: ErasurePlan) {
  return plan.categories
    .filter((each) => each.action === "retain")
    .map((each) => ({
      category: each.key,
      basis: each.basis ?? "legal_hold",
      until: each.until?.toISOString() ?? null,
    }));
}

/** The latest date any kept kind's basis lapses; null if none ever does. */
export function retainedUntil(plan: ErasurePlan): Date | null {
  const dates = plan.categories
    .filter((each) => each.action === "retain" && each.until !== null)
    .map((each) => each.until!.getTime());
  return dates.length === 0 ? null : new Date(Math.max(...dates));
}
