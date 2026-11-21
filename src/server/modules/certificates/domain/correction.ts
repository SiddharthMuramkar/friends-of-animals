// What staff may write when they revoke or reissue a certificate.
//
// Revoking and reissuing both need a reason, kept in the audit log. A
// reissue corrects only how the certificate reads: the recipient's name and
// the award label. It never changes the type, the competition or what was
// awarded; those come from the published results.
//
// Pure: no database, no clock. Loads under plain Node.

/** The most characters a reason may have. */
export const REASON_MAX_LENGTH = 500;

/** Names follow enrolment's rule: 2 to 100 characters. */
export const RECIPIENT_NAME_MIN_LENGTH = 2;
export const RECIPIENT_NAME_MAX_LENGTH = 100;

/** The most characters a corrected award label may have. */
export const AWARD_LABEL_MAX_LENGTH = 120;

const graphemes = new Intl.Segmenter("en", { granularity: "grapheme" });

/** Characters as a reader counts them: "रा" or an emoji is one. */
function characterCount(text: string): number {
  return Array.from(graphemes.segment(text)).length;
}

// C0 controls and DEL that aren't whitespace (whitespace is collapsed).
// oxlint-disable-next-line no-control-regex -- matching them is the point
const CONTROL = /[\u0000-\u0008\u000E-\u001F\u007F]/g;

/** One Unicode form, no control characters, single spaces, trimmed. */
function tidy(text: string): string {
  return text.normalize("NFC").replace(CONTROL, "").replace(/\s+/g, " ").trim();
}

export type ReasonResult =
  | { ok: true; reason: string }
  | { ok: false; error: "required" | "too_long" };

/** Reads the reason staff gave for revoking or reissuing. */
export function parseReason(input: string): ReasonResult {
  const reason = tidy(input);
  if (!reason) return { ok: false, error: "required" };
  if (characterCount(reason) > REASON_MAX_LENGTH) {
    return { ok: false, error: "too_long" };
  }
  return { ok: true, reason };
}

/** How a certificate reads, as far as a reissue may change it. */
export type CorrectableFields = {
  recipientName: string;
  /** `null` for certificates without an award, such as participation. */
  awardLabel: string | null;
};

export type CorrectableField = keyof CorrectableFields;

/** The corrections staff asked for; a field left out stays as it is. */
export type ReissueRequest = {
  recipientName?: string;
  awardLabel?: string;
};

export type CorrectionError =
  | "required"
  | "too_short"
  | "too_long"
  | "not_applicable";

export type ReissuePlan =
  | {
      ok: true;
      /** What the new certificate carries. */
      next: CorrectableFields;
      /** The fields that differ from the old certificate, in form order. */
      changed: CorrectableField[];
    }
  | {
      ok: false;
      reason: "invalid";
      errors: Partial<Record<CorrectableField, CorrectionError>>;
    }
  | { ok: false; reason: "no_change" };

/**
 * Checks a reissue request against the certificate it corrects and works
 * out what the new certificate carries. A request that changes nothing is
 * refused, so a reissue always means a real correction. Names are compared
 * in one Unicode form, so retyping the same name isn't a change, but a
 * change of case is.
 */
export function planReissue(
  current: CorrectableFields,
  request: ReissueRequest
): ReissuePlan {
  const errors: Partial<Record<CorrectableField, CorrectionError>> = {};
  const next: CorrectableFields = { ...current };

  if (request.recipientName !== undefined) {
    const name = tidy(request.recipientName);
    const length = characterCount(name);
    if (!name) errors.recipientName = "required";
    else if (length < RECIPIENT_NAME_MIN_LENGTH)
      errors.recipientName = "too_short";
    else if (length > RECIPIENT_NAME_MAX_LENGTH)
      errors.recipientName = "too_long";
    else next.recipientName = name;
  }

  if (request.awardLabel !== undefined) {
    const label = tidy(request.awardLabel);
    if (current.awardLabel === null) errors.awardLabel = "not_applicable";
    else if (!label) errors.awardLabel = "required";
    else if (characterCount(label) > AWARD_LABEL_MAX_LENGTH) {
      errors.awardLabel = "too_long";
    } else next.awardLabel = label;
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, reason: "invalid", errors };
  }

  const changed: CorrectableField[] = [];
  if (next.recipientName !== tidy(current.recipientName)) {
    changed.push("recipientName");
  }
  if (
    next.awardLabel !== null &&
    current.awardLabel !== null &&
    next.awardLabel !== tidy(current.awardLabel)
  ) {
    changed.push("awardLabel");
  }
  if (changed.length === 0) return { ok: false, reason: "no_change" };
  return { ok: true, next, changed };
}
