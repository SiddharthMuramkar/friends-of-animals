import { describe, expect, it } from "vitest";

import { DomainError } from "@/server/errors";
import { createHarness } from "@/test/harness";

import {
  CONDUCT_STATEMENT_VERSION,
  recordConductCertification,
  requireConductCertified,
} from "./conduct";

// Institution registrations (#75) are plain ids here until their table is
// on this branch.
const REGISTRATION_X = "01938a00-0000-7000-8000-00000000c001";

describe("requireConductCertified", () => {
  it("refuses a registration whose conduct nobody has certified", async () => {
    const h = await createHarness();

    const check = requireConductCertified(h.db, REGISTRATION_X);

    await expect(check).rejects.toBeInstanceOf(DomainError);
    await expect(check).rejects.toMatchObject({
      code: "conduct_not_certified",
    });
  });

  it("passes once the registration's conduct is certified", async () => {
    const h = await createHarness();
    const coordinator = await h.seed.member({ name: "Meera Iyer" });
    await recordConductCertification(h.deps, {
      institutionRegistrationId: REGISTRATION_X,
      certifiedByUserId: coordinator.id,
      statementVersion: CONDUCT_STATEMENT_VERSION,
    });

    await expect(
      requireConductCertified(h.db, REGISTRATION_X)
    ).resolves.toBeUndefined();
  });
});
