import { describe, expect, it } from "vitest";

import { parseRoleForm } from "./role-form";

const USER = "01938a00-0000-7000-8000-000000000101";
const SCHOOL = "01938a00-0000-7000-8000-000000001001";

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

describe("parseRoleForm", () => {
  it("reads a role at one institution, trimming the pasted id", () => {
    expect(
      parseRoleForm(
        form({
          userId: USER,
          role: "institution_coordinator",
          scopeType: "institution",
          scopeId: `  ${SCHOOL}\n`,
        })
      )
    ).toEqual({
      ok: true,
      input: {
        userId: USER,
        role: "institution_coordinator",
        scope: { type: "institution", id: SCHOOL },
      },
    });
  });

  it("reads a global role and ignores an id typed by mistake", () => {
    expect(
      parseRoleForm(
        form({
          userId: USER,
          role: "staff_admin",
          scopeType: "global",
          scopeId: SCHOOL,
        })
      )
    ).toEqual({
      ok: true,
      input: { userId: USER, role: "staff_admin", scope: { type: "global" } },
    });
  });

  it("points at a role or scope type that isn't on the list", () => {
    expect(
      parseRoleForm(
        form({ userId: USER, role: "owner", scopeType: "planet", scopeId: "" })
      )
    ).toEqual({ ok: false, fields: ["role", "scopeType"] });
    expect(parseRoleForm(form({ userId: USER }))).toEqual({
      ok: false,
      fields: ["role", "scopeType"],
    });
  });

  it("asks for the id when the scope is one institution, competition or organisation", () => {
    expect(
      parseRoleForm(
        form({
          userId: USER,
          role: "judge",
          scopeType: "competition",
          scopeId: "   ",
        })
      )
    ).toEqual({ ok: false, fields: ["scopeId"] });
  });
});
