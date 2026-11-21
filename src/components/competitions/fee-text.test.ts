import { createFormatter, createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";

import { formats, LOCALE } from "@/i18n/formats";
import { messages } from "@/i18n/messages";

import { feeText } from "./fee-text";

const intl = {
  t: createTranslator({
    locale: LOCALE,
    messages,
    namespace: "competitionTerms.fees",
  }),
  format: createFormatter({ locale: LOCALE, timeZone: "UTC", formats }),
};

describe("feeText", () => {
  it("writes whole rupees without paise, grouped the Indian way", () => {
    expect(
      feeText({ route: "individual", kind: "amount", paise: 12400000n }, intl)
    ).toBe("₹1,24,000");
  });

  it("keeps the paise when there are some", () => {
    expect(
      feeText({ route: "institution", kind: "amount", paise: 2500050n }, intl)
    ).toBe("₹25,000.50");
  });

  it("stays exact above 2^31 paise", () => {
    expect(
      feeText(
        { route: "institution", kind: "amount", paise: 2147483649n },
        intl
      )
    ).toBe("₹2,14,74,836.49");
  });

  it("says free, or that the fee is still to come", () => {
    expect(feeText({ route: "individual", kind: "free" }, intl)).toBe("Free");
    expect(feeText({ route: "individual", kind: "not_set" }, intl)).toBe(
      "To be announced"
    );
  });
});
