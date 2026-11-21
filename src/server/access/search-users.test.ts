import { describe, expect, it } from "vitest";

import { createHarness, type Harness } from "@/test/harness";

async function staffAdmin(h: Harness) {
  const account = await h.seed.member({ name: "Staff Admin" });
  await h.seed.grant(account, {
    role: "staff_admin",
    scope: { type: "global" },
  });
  return h.signIn(account);
}

describe("searchUsers", () => {
  it("finds users by the start of their email or any part of their name", async () => {
    const h = await createHarness();
    const admin = await h.signIn(await h.seed.superAdmin({ name: "Sunita" }));
    const asha = await h.seed.member({
      name: "Asha Rao",
      email: "asha@example.test",
    });
    const ravi = await h.seed.member({
      name: "Ravi Kumar",
      email: "ravi.k@example.test",
    });
    const neha = await h.seed.member({
      name: "Neha Iyer",
      email: "neha@school.test",
    });

    expect(await h.as(admin).searchUsers({ query: "ra" })).toEqual({
      ok: true,
      users: [
        { id: asha.id, name: "Asha Rao", email: "asha@example.test" },
        { id: ravi.id, name: "Ravi Kumar", email: "ravi.k@example.test" },
      ],
    });
    expect(await h.as(admin).searchUsers({ query: " NEHA@S " })).toEqual({
      ok: true,
      users: [{ id: neha.id, name: "Neha Iyer", email: "neha@school.test" }],
    });
    // Not the middle of an address: that would let a search list a domain.
    expect(await h.as(admin).searchUsers({ query: "school.test" })).toEqual({
      ok: true,
      users: [],
    });
  });

  it("matches % and _ as themselves, not as wildcards", async () => {
    const h = await createHarness();
    const admin = await h.signIn(await h.seed.superAdmin());
    await h.seed.member({ name: "Asha Rao" });

    expect(await h.as(admin).searchUsers({ query: "%%" })).toEqual({
      ok: true,
      users: [],
    });
    expect(await h.as(admin).searchUsers({ query: "a_h" })).toEqual({
      ok: true,
      users: [],
    });
  });

  it("lists at most 20", async () => {
    const h = await createHarness();
    const admin = await h.signIn(await h.seed.superAdmin());
    for (let n = 10; n < 35; n++) {
      await h.seed.member({ name: `Pupil ${n}` });
    }

    const result = await h.as(admin).searchUsers({ query: "pupil" });

    expect(result.ok && result.users.map((found) => found.name)).toEqual(
      Array.from({ length: 20 }, (_, i) => `Pupil ${i + 10}`)
    );
  });

  it("needs at least two characters", async () => {
    const h = await createHarness();
    const admin = await h.signIn(await h.seed.superAdmin());

    expect(await h.as(admin).searchUsers({ query: " a " })).toEqual({
      ok: false,
      error: "invalid_input",
      fields: ["query"],
    });
  });

  it("is for super and staff admins: a member and a visitor are refused", async () => {
    const h = await createHarness();
    await h.seed.member({ name: "Asha Rao" });

    expect(
      await h.as(await staffAdmin(h)).searchUsers({ query: "asha" })
    ).toMatchObject({ ok: true, users: [{ name: "Asha Rao" }] });
    for (const actor of [await h.signIn(await h.seed.member()), h.visitor()]) {
      await expect(
        h.as(actor).searchUsers({ query: "asha" })
      ).rejects.toMatchObject({ code: "forbidden" });
    }
  });
});
