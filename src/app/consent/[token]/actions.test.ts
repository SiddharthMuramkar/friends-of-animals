import { NextResponse } from "next/server";
import { expect, it, vi } from "vitest";

import { saveAnswersAction, sendCodeAction, verifyCodeAction } from "./actions";
import { ANSWER_COOKIE, answerCookieOptions } from "./cookie";

const fixture = "z".repeat(43);

it("returns form errors for invalid form envelopes before accessing the request", async () => {
  const invalidForm = {};
  await expect
    .soft(verifyCodeAction(fixture, null, invalidForm))
    .resolves.toEqual({
      ok: false,
      error: "invalid_code",
      message: "Enter the six-digit code and try again.",
    });
  await expect
    .soft(saveAnswersAction(fixture, null, invalidForm))
    .resolves.toEqual({
      ok: false,
      error: "invalid_answer",
      message: "Choose an answer for each use and try again.",
    });
});

it("returns the generic link error for invalid bound tokens at every action", async () => {
  const form = new FormData();
  const notFound = {
    ok: false,
    error: "not_found",
    message: "Check the link in your message or ask your school for help.",
  };
  await expect.soft(sendCodeAction("invalid")).resolves.toEqual(notFound);
  await expect
    .soft(verifyCodeAction("invalid", null, form))
    .resolves.toEqual(notFound);
  await expect
    .soft(saveAnswersAction("invalid", null, form))
    .resolves.toEqual(notFound);
});

it("serializes the preview answer cookie with the Secure flag", () => {
  vi.stubEnv("APP_ENV", "preview");
  try {
    const response = NextResponse.next();
    response.cookies.set(
      ANSWER_COOKIE,
      "synthetic-session",
      answerCookieOptions(fixture)
    );
    expect(response.headers.get("set-cookie")?.includes("; Secure")).toBe(true);
  } finally {
    vi.unstubAllEnvs();
  }
});
