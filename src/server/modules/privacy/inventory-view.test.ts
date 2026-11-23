import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { cmsRevision, user, verification } from "@/server/db/schema";
import { createHarness, type Harness } from "@/test/harness";

async function seedStaff(
  h: Harness,
  role: "staff_admin" | "finance" | "content_manager"
) {
  const member = await h.seed.member();
  await h.seed.grant(member, { role, scope: { type: "global" } });
  return member;
}

describe("getInventory", () => {
  it("lets a staff admin read field metadata without returning stored values", async () => {
    const h = await createHarness();
    const staff = await seedStaff(h, "staff_admin");
    const actor = await h.signIn(staff);
    h.clock.advance({ minutes: 11 });
    const { entries } = await h.as(actor).getInventory();

    expect(
      entries.find(
        ({ table, column }) => table === "contact_note" && column === "body"
      )
    ).toMatchObject({
      category: "content",
      purpose: "What staff noted while handling the message",
      subject: { kind: "contact_sender", via: "message_id" },
      retention: { policy: "contactMessages", toConfirm: true },
    });
    expect(
      entries.find(
        ({ table, column }) => table === "user" && column === "email"
      )
    ).toMatchObject({ subject: { kind: "user", via: "id" } });
    expect(JSON.stringify(entries)).not.toContain(staff.email);
  });

  it("lets a super admin read the inventory", async () => {
    const h = await createHarness();
    const admin = await h.signIn(await h.seed.superAdmin());
    const { entries } = await h.as(admin).getInventory();

    expect(entries.length).toBeGreaterThan(0);
  });

  it("catalogues story content that can name someone", async () => {
    const h = await createHarness();
    const editor = h.as(await h.signIn(await seedStaff(h, "content_manager")));
    const name = "Asha Example";
    const excerpt = `${name} helped care for rescued birds.`;
    const body = {
      blocks: [{ type: "paragraph", text: [`${name} fed the birds.`] }],
      footnotes: [],
    };
    const saved = await editor.createPost({
      kind: "story",
      title: "Caring for rescued birds",
      excerpt,
      body,
    });
    if (!saved.ok) throw new Error("The story draft could not be saved");
    expect(await editor.getPostForEdit({ postId: saved.postId })).toMatchObject(
      {
        ok: true,
        post: { body, excerpt },
      }
    );

    const admin = await h.signIn(await h.seed.superAdmin());
    const { entries } = await h.as(admin).getInventory();
    expect(entries.filter(({ table }) => table === "cms_post")).toEqual(
      expect.arrayContaining(
        ["body", "excerpt"].map((column) =>
          expect.objectContaining({
            column,
            category: "content",
            subject: { kind: "content_subject", via: column },
            retention: expect.objectContaining({ policy: "posts" }),
            onExpiry: "delete_row",
          })
        )
      )
    );
    expect(JSON.stringify(entries)).not.toContain(name);
  });

  it("describes revision authorship that survives deletion of the fixture editor's account", async () => {
    const h = await createHarness();
    const author = await seedStaff(h, "content_manager");
    const editor = h.as(await h.signIn(author));
    const draft = await editor.saveDraft({
      key: "legal_safeguarding",
      body: {
        short: [["We keep children safe."]],
        sections: [
          {
            id: "scope",
            title: "Scope",
            blocks: [{ p: ["This is a fixture."] }],
          },
        ],
      },
    });
    if (!draft.ok) throw new Error("The fixture revision could not be saved");
    expect(
      await editor.publishRevision({ revisionId: draft.revisionId })
    ).toMatchObject({
      ok: true,
    });

    await h.db.delete(user).where(eq(user.id, author.id));
    const [revision] = await h.db
      .select()
      .from(cmsRevision)
      .where(eq(cmsRevision.id, draft.revisionId));
    expect(revision).toMatchObject({
      status: "published",
      createdByUserId: author.id,
      publishedByUserId: author.id,
    });

    const admin = await h.signIn(await h.seed.superAdmin());
    const { entries } = await h.as(admin).getInventory();
    expect(
      entries.filter(({ table }) => table === "cms_revision")
    ).toMatchObject(
      ["created_by_user_id", "published_by_user_id"].map((column) => ({
        column,
        subject: { kind: "user", via: column },
        retention: {
          policy: "cmsRevisionAuthorship",
          period:
            "Kept with the revision, including after the staff account is deleted",
        },
        onExpiry: "retain",
      }))
    );
    expect(
      entries.find(
        ({ table, column }) =>
          table === "setting" && column === "updated_by_user_id"
      )
    ).toMatchObject({
      retention: { policy: "staffRecords" },
      onExpiry: "set_null",
    });
  });

  it("describes stored email and SMS verification data before the recipient has an account", async () => {
    const h = await createHarness();
    const admin = await h.signIn(await h.seed.superAdmin());
    const visitor = h.as(h.visitor());
    const email = "signup@example.test";
    const phone = "9000000777";
    await h.settings.set("sms.enabled", true);
    expect(
      await visitor.requestEmailCode({
        intent: "sign-up",
        email,
        name: "Asha Example",
      })
    ).toEqual({ ok: true });
    expect(await visitor.requestPhoneCode({ phone })).toEqual({ ok: true });
    expect(
      await h.db.select().from(user).where(eq(user.email, email))
    ).toHaveLength(0);

    const rows = await h.db.select().from(verification);
    expect(rows).toHaveLength(2);
    const smsRow = rows.find(({ identifier }) =>
      identifier.startsWith("sms-sign-in:")
    );
    const emailRow = rows.find((row) => row !== smsRow);
    expect(emailRow?.identifier).toMatch(/^[\w-]{43}$/);
    expect(smsRow?.identifier).toMatch(/^sms-sign-in:.+$/);
    expect(smsRow?.identifier).not.toContain(phone);
    expect(emailRow?.value).toMatch(/^[\w-]{43}:0$/);
    expect(smsRow?.value).toMatch(/^[\w-]{43}:0$/);

    const { entries } = await h.as(admin).getInventory();
    const recipient = { kind: "recipient", via: "identifier" };
    expect(
      entries.filter(({ table }) => table === "verification")
    ).toMatchObject([
      {
        column: "identifier",
        subject: recipient,
        purpose: expect.stringMatching(
          /hash of the email sign-in identifier.*namespaced keyed hash of the phone.*before they have an account/i
        ),
      },
      {
        column: "value",
        subject: recipient,
        purpose: expect.stringMatching(
          /hashed email code.*keyed SMS code digest.*failed attempts/i
        ),
      },
    ]);
  });

  it("refuses finance, a member and a visitor", async () => {
    const h = await createHarness();
    const finance = await h.signIn(await seedStaff(h, "finance"));
    h.cookies.clear();
    const member = await h.signIn(await h.seed.member());

    for (const actor of [finance, member, h.visitor()]) {
      await expect(h.as(actor).getInventory()).rejects.toMatchObject({
        code: "forbidden",
      });
    }
  });

  it("requires the staff admin's second factor", async () => {
    const h = await createHarness();
    const staff = await seedStaff(h, "staff_admin");
    await h.seed.authenticator(staff);
    const actor = await h.signIn(staff, undefined, {
      secondFactor: false,
    });

    await expect(h.as(actor).getInventory()).rejects.toMatchObject({
      code: "second_factor_required",
    });
  });
});
