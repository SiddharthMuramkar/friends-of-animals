import { eq } from "drizzle-orm";
import { RouteModule } from "next/dist/server/route-modules/route-module";
import { IncomingMessage } from "node:http";
import { Socket } from "node:net";
import { inspect } from "node:util";
import { describe, expect, it, vi } from "vitest";

import { inboxItem, outbox, userRole } from "@/server/db/schema";
import { createHarness } from "@/test/harness";

import {
  announcementWorld,
  bornYearsBefore2027,
  FULL_AUDIENCE_COUNTS,
  fullAudience,
  registrants,
} from "./testing";

// #84 AC2 and AC6: a preview renders the email and the inbox message for a
// sample recipient and counts who it would reach, from the confirmed
// registrations only. It sends nothing and writes no outbox or inbox row.

describe("previewAnnouncement", () => {
  it.each(["render", "action"] as const)(
    "logs a safe roster lookup failure from the web %s",
    async (routeType) => {
      const h = await createHarness();
      const world = await announcementWorld(h);
      const address = "roster-guardian@example.test";
      const school = await registrants(h, world.competition).school({
        name: "Hill School",
        coordinators: [{ name: "Meera Iyer", email: "meera@example.test" }],
        students: [
          {
            fullName: "Aanya Rao",
            dateOfBirth: bornYearsBefore2027(10),
            status: "confirmed",
            guardian: {
              name: "Kiran Rao",
              email: address,
              phone: "+919000000303",
            },
          },
        ],
      });
      const manager = await world.manager();
      const id = await world.draft(manager);
      // The school still has an eligible pupil. With no coordinator to look
      // up, the roster lookup is the first query to use the missing column.
      await h.db
        .delete(userRole)
        .where(eq(userRole.userId, school.coordinators[0]!.id));
      await h.db.$client.exec(
        'ALTER TABLE "user" RENAME COLUMN phone_hash TO unavailable_phone_hash'
      );
      const asManager = h.as(manager);
      const target = { id, competitionId: world.competitionId };
      const request = new IncomingMessage(new Socket());
      request.method = routeType === "render" ? "GET" : "POST";
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        const response =
          routeType === "render"
            ? asManager.previewAnnouncement(target)
            : asManager.sendAnnouncement({ ...target, revision: 1 });
        const error: unknown = await response.catch(
          (failure: unknown) => failure
        );
        await RouteModule.prototype.onRequestError.call(
          { instrumentationOnRequestError: async () => {} },
          request,
          error,
          {
            routerKind: "App Router",
            routePath:
              "/admin/competitions/[id]/announcements/[announcementId]",
            routeType,
            renderSource: undefined,
            revalidateReason: undefined,
          },
          false
        );
        expect(log).toHaveBeenCalledTimes(1);
        const logged = inspect(log.mock.calls[0], { depth: null });
        expect(logged.includes(address)).toBe(false);
        expect(logged).toContain(
          "announcement_roster_account_lookup_failed (42703)"
        );
        expect(error).toEqual(
          new Error("announcement_roster_account_lookup_failed (42703)")
        );
        expect(error).not.toHaveProperty("cause");
      } finally {
        log.mockRestore();
        request.destroy();
      }
    }
  );

  it("renders the email and the inbox message, with the sections in reading order", async () => {
    const h = await createHarness();
    const world = await announcementWorld(h);
    const manager = await world.manager();
    const id = await world.draft(manager, {
      duration: null,
      message: "See you there!",
    });

    const result = await h.as(manager).previewAnnouncement({ id });

    if (!result.ok) throw new Error(`No preview: ${result.error}`);
    const body = [
      "Date and time",
      "6 February 2027 at 10:00 am IST",
      "",
      "Theme",
      "Street dogs of our city",
      "",
      "Permitted materials",
      "Pencils, crayons and watercolours on A3 paper",
      "",
      "How to submit",
      "Photograph your drawing in daylight.",
      "Upload it from your dashboard.",
      "",
      "Your artwork on paper",
      "Post the original drawing to the FOA office.",
      "",
      "Deadlines",
      "Uploads close on 13 February 2027 at 11:59 pm IST.",
      "",
      "Questions?",
      "Write to competitions@foa.example",
      "",
      "See you there!",
    ].join("\n");
    expect(result.preview.email).toEqual({
      subject: "Paws for Thought: Phase 3: the drawing day",
      text: `Hello Asha Rao,\n\nThere is news about Paws for Thought.\n\n${body}\n\nFriends of Animals`,
    });
    expect(result.preview.inApp).toEqual({
      title: "Paws for Thought: Phase 3: the drawing day",
      body,
    });
  });

  it("counts who it would reach from confirmed registrations, and sends nothing", async () => {
    const h = await createHarness();
    const world = await announcementWorld(h);
    await fullAudience(h, world);
    const manager = await world.manager();
    const id = await world.draft(manager);
    // The set-up's own messages (the school's verification) go first.
    await h.drain();
    const emailsBefore = h.email.sent.length;

    const result = await h.as(manager).previewAnnouncement({ id });
    await h.drain();

    expect(result).toMatchObject({
      ok: true,
      preview: { counts: FULL_AUDIENCE_COUNTS },
    });
    // Nothing went anywhere: no message, no event, no inbox item.
    expect(h.email.sent.slice(emailsBefore)).toEqual([]);
    expect(h.sms.sent).toEqual([]);
    expect(
      await h.db
        .select()
        .from(outbox)
        .where(eq(outbox.eventType, "competition.announcement_sent"))
    ).toEqual([]);
    expect(
      await h.db
        .select()
        .from(inboxItem)
        .where(eq(inboxItem.templateKey, "announcements.announcement"))
    ).toEqual([]);
  });

  it("says not_found for an announcement that doesn't exist", async () => {
    const h = await createHarness();
    const world = await announcementWorld(h);
    const manager = await world.manager();

    expect(
      await h
        .as(manager)
        .previewAnnouncement({ id: "01938a00-0000-7000-8000-00000000dead" })
    ).toEqual({ ok: false, error: "not_found" });
  });
});
