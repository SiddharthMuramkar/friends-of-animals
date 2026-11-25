import { describe, expect, it } from "vitest";
import { createHarness } from "@/test/harness";

const profile = { displayName: "  Asha Rao  ", about: "  I love animals.  " };

describe("community membership", () => {
  it("joins as oneself, and records a private community milestone exactly once", async () => {
    const h = await createHarness();
    const member = await h.signIn(await h.seed.member());
    const api = h.as(member);
    await expect(
      h.as(h.visitor()).joinCommunity(profile)
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(await api.getMyCommunity()).toMatchObject({ member: null });
    expect(await api.joinCommunity(profile)).toMatchObject({ ok: true });
    const joined = await api.getMyCommunity();
    expect(joined.member).toMatchObject({
      status: "active",
      displayName: "Asha Rao",
      about: "I love animals.",
    });
    expect(await api.joinCommunity(profile)).toEqual({
      ok: false,
      error: "already_member",
    });
    const timeline = await api.getTimeline();
    expect(timeline.entries).toMatchObject([
      {
        kind: "milestone.community_member",
        occurredAt: h.clock.now(),
        category: "community",
      },
    ]);
    expect(timeline.milestones).toMatchObject([
      { kind: "community_member", competitionId: null },
    ]);
    await expect(h.as(h.visitor()).getTimeline()).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(h.as(h.visitor()).getMyCommunity()).rejects.toMatchObject({
      code: "forbidden",
    });
  });
});

import { linkedTeen, staffActor } from "../volunteers/testing";

describe("community member management", () => {
  it("edits, leaves and rejoins the very same membership without another milestone", async () => {
    const h = await createHarness();
    const api = h.as(await h.signIn(await h.seed.member()));
    const visitor = h.as(h.visitor());
    await expect(visitor.updateMemberProfile(profile)).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(visitor.leaveCommunity()).rejects.toMatchObject({
      code: "forbidden",
    });
    expect(await api.leaveCommunity()).toEqual({
      ok: false,
      error: "not_member",
    });
    const joined = await api.joinCommunity(profile);
    if (!joined.ok) throw Error(joined.error);
    expect(await api.updateMemberProfile({ displayName: "X" })).toMatchObject({
      ok: false,
      error: "invalid_input",
    });
    expect(
      await api.updateMemberProfile({
        displayName: "  New name  ",
        about: "   ",
      })
    ).toMatchObject({ ok: true, memberId: joined.memberId });
    expect((await api.getMyCommunity()).member).toMatchObject({
      displayName: "New name",
      about: null,
    });
    h.clock.advance({ days: 1 });
    expect(await api.leaveCommunity()).toMatchObject({
      ok: true,
      memberId: joined.memberId,
    });
    expect((await api.getMyCommunity()).member).toMatchObject({
      status: "left",
      leftAt: h.clock.now(),
    });
    expect(await api.updateMemberProfile(profile)).toEqual({
      ok: false,
      error: "not_member",
    });
    expect(await api.joinCommunity(profile)).toMatchObject({
      ok: true,
      memberId: joined.memberId,
    });
    expect((await api.getTimeline()).entries).toHaveLength(1);
  });

  it("separates a guardian's own membership and each child's; a linked teen joins themselves", async () => {
    const h = await createHarness();
    const teen = await linkedTeen(h);
    const family = await h.seed.guardian({
      children: [
        { fullName: "Maya Rao", age: 8 },
        { fullName: "Meera Rao", age: 10 },
      ],
    });
    const api = h.as(await h.signIn(family.account));
    const childId = family.childIds[0]!;
    const sibling = family.childIds[1]!;
    const other = h.as(teen.guardian.actor);
    await expect(
      other.joinCommunity({ childId, displayName: "Not mine" })
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(other.getTimeline({ childId })).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(other.getMyCommunity({ childId })).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(
      other.updateMemberProfile({ childId, ...profile })
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(other.leaveCommunity({ childId })).rejects.toMatchObject({
      code: "forbidden",
    });
    expect(
      await api.joinCommunity({ childId, displayName: "Maya" })
    ).toMatchObject({ ok: true });
    expect((await api.getTimeline({ childId })).milestones).toHaveLength(1);
    expect((await api.getTimeline({ childId: sibling })).entries).toEqual([]);
    expect((await api.getTimeline()).entries).toEqual([]);
    expect((await api.getMyCommunity()).member).toBeNull();
    expect(
      await other.joinCommunity({
        childId: teen.profileId,
        displayName: "Arjun",
      })
    ).toEqual({ ok: false, error: "child_joins_themselves" });
    const teenApi = h.as(teen.teen.actor);
    expect(await teenApi.joinCommunity({ displayName: "Arjun" })).toMatchObject(
      { ok: true }
    );
    expect(await other.getTimeline({ childId: teen.profileId })).toEqual(
      await teenApi.getTimeline()
    );
    await expect(teenApi.getTimeline({ childId })).rejects.toMatchObject({
      code: "forbidden",
    });
    expect(
      await api.updateMemberProfile({ childId, displayName: "Maya R." })
    ).toMatchObject({ ok: true });
    expect(await api.leaveCommunity({ childId })).toMatchObject({ ok: true });
    await expect(api.listMembers({})).rejects.toMatchObject({
      code: "forbidden",
    });
    const manager = h.as(await staffActor(h, "community_manager"));
    const members = await manager.listMembers({});
    expect(members.members).toMatchObject(
      expect.arrayContaining([
        expect.objectContaining({
          displayName: "Maya R.",
          status: "left",
          subjectKind: "profile",
        }),
        expect.objectContaining({
          displayName: "Arjun",
          status: "active",
          subjectKind: "user",
        }),
      ])
    );
    expect(JSON.stringify(members)).not.toContain("about");
  });
});

it("converges a former accountless child's profile and own-account journey when the verified login links", async () => {
  const h = await createHarness();
  const family = await h.seed.guardian({
    children: [{ fullName: "Child sample", age: 15 }],
  });
  const childId = family.childIds[0]!;
  const parent = h.as(await h.signIn(family.account));
  const joined = await parent.joinCommunity({
    childId,
    displayName: "Child member",
  });
  if (!joined.ok) throw Error(joined.error);
  h.clock.advance({ seconds: 1 });
  const account = await h.seed.member({
    name: "Teen sample",
    email: "teen-link@example.test",
  });
  const teen = h.as(await h.signIn(account));
  expect(
    await teen.joinCommunity({ displayName: "My own name" })
  ).toMatchObject({ ok: true });
  expect(
    await parent.inviteTeenLogin({ childId, email: account.email })
  ).toMatchObject({ ok: true });
  await h.drain();
  const token = /\/invitations\/([A-Za-z0-9_-]{43})(?![A-Za-z0-9_-])/.exec(
    h.email.lastTo(account.email)?.text ?? ""
  )?.[1];
  if (!token) throw Error("Missing invitation");
  expect(await teen.acceptTeenInvitation({ token })).toMatchObject({
    ok: true,
    childId,
  });
  expect((await teen.getMyCommunity()).member).toMatchObject({
    id: joined.memberId,
    displayName: "My own name",
    status: "active",
  });
  expect((await teen.getTimeline()).milestones).toHaveLength(1);
  expect((await teen.getTimeline()).entries).toHaveLength(1);
  expect(await parent.getTimeline({ childId })).toEqual(
    await teen.getTimeline()
  );
  const staff = h.as(await staffActor(h, "community_manager"));
  expect(await staff.listMembers({})).toMatchObject({ ok: true, total: 1 });
  expect(await teen.leaveCommunity()).toMatchObject({
    ok: true,
    memberId: joined.memberId,
  });
  expect((await parent.getMyCommunity({ childId })).member).toMatchObject({
    status: "left",
  });
});
