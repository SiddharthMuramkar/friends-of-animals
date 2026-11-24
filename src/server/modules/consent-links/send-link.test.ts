import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { auditLog } from "@/server/db/schema";
import { createHarness } from "@/test/harness";

import { consentLinkWorld, deliveredToken, GUARDIAN_EMAIL } from "./testing";

describe("sendConsentLink", () => {
  it("queues one link, protects its contact and token, and revokes it on resend", async () => {
    const h = await createHarness();
    const world = await consentLinkWorld(h);
    const sent = await world.coordinator.sendConsentLink(world.send);
    if (!sent.ok) throw new Error(`Could not send: ${sent.error}`);
    expect(sent.status).toBe("pending");
    expect(sent.expiresAt.getTime() - h.clock.now().getTime()).toBe(
      604_800_000
    );
    expect(h.email.inbox(GUARDIAN_EMAIL)).toHaveLength(0);
    await h.drain();
    expect(h.email.inbox(GUARDIAN_EMAIL)).toHaveLength(1);
    const token = deliveredToken(h);

    const { rows } = await h.db.execute(sql`
      select token_ciphertext, token_hash, contact_ciphertext, contact_hash
      from consent_link where id = ${sent.linkId}
    `);
    expect(rows).toHaveLength(1);
    const raw = JSON.stringify(rows);
    expect(raw.includes(token)).toBe(false);
    expect(raw.includes(GUARDIAN_EMAIL)).toBe(false);
    const audit = await h.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.entityId, sent.linkId));
    expect(audit.map((entry) => entry.action)).toEqual(["consent_link.sent"]);
    expect(JSON.stringify(audit).includes(token)).toBe(false);
    expect(JSON.stringify(audit).includes(GUARDIAN_EMAIL)).toBe(false);

    expect(await world.coordinator.sendConsentLink(world.send)).toMatchObject({
      ok: true,
    });
    await h.drain();
    expect(h.email.inbox(GUARDIAN_EMAIL)).toHaveLength(2);
    expect(deliveredToken(h) === token).toBe(false);
    const visitor = h.as(h.visitor());
    expect(await visitor.viewConsentLink({ token })).toEqual({
      status: "revoked",
    });
    expect(
      await visitor.viewConsentLink({ token: deliveredToken(h) })
    ).toMatchObject({
      status: "sent",
    });
  });

  it("refuses disabled SMS, students outside the registration, and competitions with no public offer", async () => {
    const h = await createHarness();
    const world = await consentLinkWorld(h, { offers: false });
    expect(
      await world.coordinator.sendConsentLink({
        ...world.send,
        channel: "sms",
        address: "9000000301",
      })
    ).toEqual({ ok: false, error: "sms_disabled" });
    expect(
      await world.coordinator.sendConsentLink({
        ...world.send,
        studentId: world.registrationId,
      })
    ).toEqual({ ok: false, error: "not_found" });
    expect(await world.coordinator.sendConsentLink(world.send)).toEqual({
      ok: false,
      error: "nothing_offered",
    });
  });
});
