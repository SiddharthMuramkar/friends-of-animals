// Values a payment journey (#77) reads off a page. Pure, so Vitest checks
// it beside the journeys (payment-values.test.ts).

/**
 * A registration number: the competition's code, "-R-" and 6 characters
 * of Crockford's base 32 (src/server/modules/registration/domain/
 * registration-number.ts).
 */
export const REGISTRATION_NUMBER = /^[A-Z]{3,6}\d{2}-R-[0-9A-HJKMNP-TV-Z]{6}$/;

/** Every registration number in `text` (a page's text), in page order. */
export function registrationNumbersIn(text: string): string[] {
  return [
    ...text.matchAll(/(?<![A-Z0-9])[A-Z]{3,6}\d{2}-R-[0-9A-HJKMNP-TV-Z]{6}\b/g),
  ].map(([number]) => number);
}
