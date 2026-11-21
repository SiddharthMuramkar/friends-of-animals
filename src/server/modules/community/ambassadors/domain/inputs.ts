// What the ambassador forms send (#122), checked at the edge before a use
// case runs. Issue messages are codes (`required`, `too_long`,
// `invalid_characters`) that the pages map to copy in the `ambassadors`
// messages, never zod's English.
//
// Text is counted the way the Community module counts it (#119): an emoji
// or other astral character is one character. Textareas submit CRLF line
// breaks, which become LF before anything is counted or stored.
//
// Pure. Loads under plain Node, so no "server-only" and no "@/" imports.

import { z } from "zod";

import { DECISION_REASON_MAX_LENGTH } from "./application-status";

export const MOTIVATION_MAX_LENGTH = 1000;

/** Characters, counting an emoji or other astral character once. */
const length = (text: string) => Array.from(text).length;

/** C0 control characters other than the line feed, and DEL. */
const hasControlOtherThanNewline = (text: string) =>
  Array.from(text).some((char) => {
    const code = char.codePointAt(0)!;
    return (code < 0x20 && char !== "\n") || code === 0x7f;
  });

/** Free text over several lines: trimmed, LF only, 1 to `max` characters. */
const paragraphs = (max: number) =>
  z
    .string()
    .overwrite((text) => text.replace(/\r\n?/g, "\n"))
    .trim()
    .refine((text) => text !== "", "required")
    .refine((text) => length(text) <= max, "too_long")
    .refine((text) => !hasControlOtherThanNewline(text), "invalid_characters");

/** `applyForAmbassador`: why the member wants to be an ambassador. */
export const applyForAmbassadorInput = z.strictObject({
  motivation: paragraphs(MOTIVATION_MAX_LENGTH),
});

/** `declineAmbassador`: the reason the applicant is told. */
export const declineAmbassadorInput = z.strictObject({
  applicationId: z.uuid(),
  reason: paragraphs(DECISION_REASON_MAX_LENGTH),
});

/** `approveAmbassador`, `withdrawAmbassadorApplication` and the detail read. */
export const applicationIdInput = z.strictObject({
  applicationId: z.uuid(),
});
