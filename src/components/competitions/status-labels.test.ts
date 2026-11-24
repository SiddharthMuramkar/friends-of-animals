import { describe, expect, it } from "vitest";

import messages from "../../../messages/en-IN/competitionStatus.json";
import { COMPETITION_STATUSES } from "@/server/modules/competitions/domain/status-machine";

// Every stored status reads as a word on the chip (icon plus word) and in a
// sentence, cancelled (#80) included, so no page shows a key path.
describe("the competition status words", () => {
  it.each(COMPETITION_STATUSES)(
    "names %s on its chip and in a sentence",
    (status) => {
      const { label, inSentence } = messages.competitionStatus;
      expect(label).toHaveProperty(status, expect.stringMatching(/\S/));
      expect(inSentence).toHaveProperty(status, expect.stringMatching(/\S/));
    }
  );

  it("calls a cancelled competition cancelled", () => {
    expect(messages.competitionStatus.label).toHaveProperty(
      "cancelled",
      "Cancelled"
    );
  });
});
