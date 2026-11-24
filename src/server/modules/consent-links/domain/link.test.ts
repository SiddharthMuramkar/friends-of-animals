import { describe, expect, it } from "vitest";

import {
  ANSWER_WINDOW_MS,
  CODE_MAX_ATTEMPTS,
  CODE_MAX_SENDS,
  CODE_RESEND_COOLDOWN_MS,
  CODE_TTL_MS,
  closedReason,
  decideAnswer,
  decideRevoke,
  decideSendCode,
  decideVerifyCode,
  LINK_TTL_MS,
  linkExpiresAt,
  linkStatus,
  type LinkState,
} from "./link";

const SENT_AT = new Date("2027-01-15T04:30:00.000Z");
const EXPIRES_AT = new Date("2027-01-22T04:30:00.000Z");
const at = (ms: number) => new Date(SENT_AT.getTime() + ms);
const MINUTE = 60_000;

const fresh: LinkState = {
  status: "pending",
  expiresAt: EXPIRES_AT,
  codesSent: 0,
  lastCodeSentAt: null,
  codeExpiresAt: null,
  codeAttempts: 0,
  verifiedAt: null,
};

/** A link whose first code went out at `sentAt`. */
const withCode = (sentAt: Date): LinkState => ({
  ...fresh,
  codesSent: 1,
  lastCodeSentAt: sentAt,
  codeExpiresAt: new Date(sentAt.getTime() + CODE_TTL_MS),
});

/** A link verified at `verifiedAt`. */
const verified = (verifiedAt: Date): LinkState => ({
  ...withCode(new Date(verifiedAt.getTime() - MINUTE)),
  codeExpiresAt: verifiedAt,
  verifiedAt,
});

describe("lifetimes", () => {
  it("are seven days for a link and ten minutes for a code", () => {
    expect(LINK_TTL_MS).toBe(604_800_000);
    expect(linkExpiresAt(SENT_AT)).toEqual(EXPIRES_AT);
    expect(CODE_TTL_MS).toBe(600_000);
    expect(ANSWER_WINDOW_MS).toBe(1_800_000);
  });
});

describe("closedReason", () => {
  it("is null while pending and before expiry", () => {
    expect(closedReason(fresh, at(LINK_TTL_MS - 1))).toBeNull();
  });

  it("is expired from the expiry instant on", () => {
    expect(closedReason(fresh, EXPIRES_AT)).toBe("expired");
  });

  it("puts used before revoked before expired", () => {
    expect(closedReason({ ...fresh, status: "used" }, EXPIRES_AT)).toBe(
      "already_used"
    );
    expect(closedReason({ ...fresh, status: "revoked" }, EXPIRES_AT)).toBe(
      "revoked"
    );
  });
});

describe("linkStatus", () => {
  it("is sent, then opened once a code went out", () => {
    expect(linkStatus(fresh, SENT_AT)).toBe("sent");
    expect(linkStatus(withCode(SENT_AT), at(MINUTE))).toBe("opened");
  });

  it("is verified only inside the answer window", () => {
    const link = verified(SENT_AT);
    expect(linkStatus(link, at(ANSWER_WINDOW_MS - 1))).toBe("verified");
    expect(linkStatus(link, at(ANSWER_WINDOW_MS))).toBe("opened");
  });

  it("is answered, revoked or expired when closed", () => {
    expect(linkStatus({ ...fresh, status: "used" }, SENT_AT)).toBe("answered");
    expect(linkStatus({ ...fresh, status: "revoked" }, SENT_AT)).toBe(
      "revoked"
    );
    expect(linkStatus(verified(SENT_AT), EXPIRES_AT)).toBe("expired");
  });
});

describe("decideSendCode", () => {
  it("sends the first code, valid for ten minutes", () => {
    expect(decideSendCode(fresh, SENT_AT)).toEqual({
      ok: true,
      patch: {
        codesSent: 1,
        lastCodeSentAt: SENT_AT,
        codeExpiresAt: at(CODE_TTL_MS),
        codeAttempts: 0,
        verifiedAt: null,
      },
    });
  });

  it("makes the guardian wait a minute between codes", () => {
    const link = withCode(SENT_AT);
    expect(decideSendCode(link, at(CODE_RESEND_COOLDOWN_MS - 1))).toEqual({
      ok: false,
      reason: "wait",
      retryAt: at(CODE_RESEND_COOLDOWN_MS),
    });
    expect(decideSendCode(link, at(CODE_RESEND_COOLDOWN_MS))).toMatchObject({
      ok: true,
      patch: { codesSent: 2 },
    });
  });

  it("resets attempts and ends an answer window with a new code", () => {
    const link = { ...verified(SENT_AT), codeAttempts: 3 };
    expect(decideSendCode(link, at(5 * MINUTE))).toMatchObject({
      ok: true,
      patch: { codeAttempts: 0, verifiedAt: null },
    });
  });

  it("stops after five codes", () => {
    const link = { ...withCode(SENT_AT), codesSent: CODE_MAX_SENDS };
    expect(decideSendCode(link, at(60 * MINUTE))).toEqual({
      ok: false,
      reason: "too_many_codes",
    });
  });

  it("refuses on a used, revoked or expired link", () => {
    expect(decideSendCode({ ...fresh, status: "used" }, SENT_AT)).toEqual({
      ok: false,
      reason: "already_used",
    });
    expect(decideSendCode({ ...fresh, status: "revoked" }, SENT_AT)).toEqual({
      ok: false,
      reason: "revoked",
    });
    expect(decideSendCode(fresh, EXPIRES_AT)).toEqual({
      ok: false,
      reason: "expired",
    });
  });
});

describe("decideVerifyCode", () => {
  const link = withCode(SENT_AT);

  it("verifies a right code, spends it and opens the answer window", () => {
    const now = at(2 * MINUTE);
    expect(decideVerifyCode(link, now, true)).toEqual({
      ok: true,
      patch: { verifiedAt: now, codeExpiresAt: now, codeAttempts: 0 },
      answerBy: new Date(now.getTime() + ANSWER_WINDOW_MS),
    });
  });

  it("counts a wrong code and says how many tries are left", () => {
    expect(decideVerifyCode(link, at(MINUTE), false)).toEqual({
      ok: false,
      reason: "wrong_code",
      attemptsLeft: CODE_MAX_ATTEMPTS - 1,
      patch: { codeAttempts: 1 },
    });
  });

  it("locks the code after five wrong tries, even for the right code", () => {
    const tried = { ...link, codeAttempts: CODE_MAX_ATTEMPTS };
    expect(decideVerifyCode(tried, at(MINUTE), true)).toEqual({
      ok: false,
      reason: "code_locked",
    });
  });

  it("refuses a code from its expiry instant on", () => {
    expect(decideVerifyCode(link, at(CODE_TTL_MS - 1), true).ok).toBe(true);
    expect(decideVerifyCode(link, at(CODE_TTL_MS), true)).toEqual({
      ok: false,
      reason: "code_expired",
    });
  });

  it("refuses a spent code a second time", () => {
    expect(decideVerifyCode(verified(SENT_AT), at(MINUTE), true)).toMatchObject(
      { ok: false, reason: "code_expired" }
    );
  });

  it("needs a code to have been sent", () => {
    expect(decideVerifyCode(fresh, SENT_AT, true)).toEqual({
      ok: false,
      reason: "no_code",
    });
  });

  it("refuses on a closed link before looking at the code", () => {
    expect(
      decideVerifyCode({ ...link, status: "used" }, at(MINUTE), true)
    ).toEqual({ ok: false, reason: "already_used" });
    expect(decideVerifyCode(link, EXPIRES_AT, true)).toEqual({
      ok: false,
      reason: "expired",
    });
  });
});

describe("decideAnswer", () => {
  const link = verified(SENT_AT);

  it("uses the link up when answered inside the window", () => {
    const now = at(ANSWER_WINDOW_MS - 1);
    expect(decideAnswer(link, now, true)).toEqual({
      ok: true,
      patch: { status: "used", usedAt: now },
    });
  });

  it("can't be answered twice", () => {
    expect(decideAnswer({ ...link, status: "used" }, at(MINUTE), true)).toEqual(
      { ok: false, reason: "already_used" }
    );
  });

  it("needs a verified guardian with the answer-session secret", () => {
    expect(decideAnswer(withCode(SENT_AT), at(MINUTE), true)).toEqual({
      ok: false,
      reason: "not_verified",
    });
    expect(decideAnswer(link, at(MINUTE), false)).toEqual({
      ok: false,
      reason: "not_verified",
    });
  });

  it("closes the window thirty minutes after verifying", () => {
    expect(decideAnswer(link, at(ANSWER_WINDOW_MS), true)).toEqual({
      ok: false,
      reason: "window_closed",
    });
  });

  it("refuses once the link expired, even mid-window", () => {
    const late = verified(new Date(EXPIRES_AT.getTime() - MINUTE));
    expect(decideAnswer(late, EXPIRES_AT, true)).toEqual({
      ok: false,
      reason: "expired",
    });
  });
});

describe("decideRevoke", () => {
  it("withdraws a pending link, expired or not", () => {
    expect(decideRevoke(fresh, SENT_AT)).toEqual({
      ok: true,
      patch: { status: "revoked", revokedAt: SENT_AT },
    });
    expect(decideRevoke(fresh, EXPIRES_AT).ok).toBe(true);
  });

  it("leaves used and revoked links alone", () => {
    expect(decideRevoke({ status: "used" }, SENT_AT)).toEqual({
      ok: false,
      reason: "already_used",
    });
    expect(decideRevoke({ status: "revoked" }, SENT_AT)).toEqual({
      ok: false,
      reason: "revoked",
    });
  });
});
