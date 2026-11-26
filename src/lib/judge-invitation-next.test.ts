import { expect, it } from "vitest";
import { judgeInvitationNext } from "./judge-invitation-next";
it("continues only to a valid local judge invitation", () => {
  const path = `/judge/invitations/${"a".repeat(43)}`;
  expect(judgeInvitationNext(path)).toBe(path);
  for (const invalid of [
    "https://outside.test",
    "//outside.test",
    "/dashboard",
    `${path}?next=//outside.test`,
    `${path}/x`,
    "/judge/invitations/no",
  ])
    expect(judgeInvitationNext(invalid)).toBeNull();
});
