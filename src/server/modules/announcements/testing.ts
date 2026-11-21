// Test helpers for the announcements module: a world with two competitions,
// actors holding chosen roles, and fakes for the ports that wait on other
// units (./ports.ts). Tests only: nothing in the app imports this file.
//
// The fakes follow the real code on those units' branches: `authorize`
// decides like #59's `role("competition_manager")` rule over competition
// scopes, and `deliver` sends each dedupe key once, as #69's message log
// will. Once those units land, the world seeds real grants and
// registrations instead and the tests call `h.as(actor)`.

import { createHmac } from "node:crypto";

import type { Actor } from "@/server/actor";
import { DomainError } from "@/server/errors";
import { uuidv7 } from "@/server/ids";
import type { Harness } from "@/test/harness";

import type { AudienceSnapshot } from "./domain/audience";
import type { AnnouncementContentInput } from "./domain/content";
import { announcementUseCasesWith } from "./index";
import type {
  AnnouncementAuditEntry,
  AnnouncementPorts,
  MessageChannel,
  MessageVariables,
  OutgoingMessage,
  RenderedMessage,
} from "./ports";

/** A role held globally, or for one competition (`competitionId`). */
export type FakeGrant = { role: string; competitionId?: string };

const EMPTY_AUDIENCE: AudienceSnapshot = {
  individualRegistrations: [],
  institutionRegistrations: [],
};

/** The fake renderer's copy, standing in for #69's `announcement` rows. */
const FAKE_TEMPLATES: Record<
  MessageChannel,
  { subject: string; text: string }
> = {
  email: {
    subject: "{announcement.subject}",
    text: "Hello {recipient.name},\n\n{announcement.body}",
  },
  in_app: {
    subject: "{announcement.subject}",
    text: "{announcement.body}",
  },
};

function fill(template: string, variables: MessageVariables): string {
  return template.replace(/\{([a-z.A-Z]+)\}/g, (_, name: string) => {
    const value = variables[name];
    if (value === undefined) throw new Error(`No value for ${name}`);
    return value;
  });
}

export class FakeAnnouncementPorts implements AnnouncementPorts {
  readonly #grants = new Map<string, FakeGrant[]>();
  readonly #audiences = new Map<string, AudienceSnapshot>();
  readonly #deliveredKeys = new Set<string>();
  #failures = 0;

  /** Every audit entry written, with who wrote it. */
  readonly audits: { entry: AnnouncementAuditEntry; actor: Actor }[] = [];
  /** Every message delivered for the first time, in order. */
  readonly delivered: OutgoingMessage[] = [];
  /** Every message rendered (previews), in order. */
  readonly rendered: { channel: MessageChannel }[] = [];

  grant(userId: string, grant: FakeGrant): void {
    this.#grants.set(userId, [...(this.#grants.get(userId) ?? []), grant]);
  }

  /** The registrants `loadAudience` returns for `competitionId`. */
  setAudience(competitionId: string, snapshot: AudienceSnapshot): void {
    this.#audiences.set(competitionId, snapshot);
  }

  /** Makes the next `count` deliveries throw; nothing is delivered. */
  failNext(count: number): void {
    this.#failures = count;
  }

  async authorize(
    { actor }: { actor: Actor },
    competitionId: string | null
  ): Promise<{ role: string | null }> {
    const covering =
      actor.kind === "user" &&
      (this.#grants.get(actor.userId) ?? []).some(
        (grant) =>
          grant.role === "competition_manager" &&
          (grant.competitionId === undefined ||
            grant.competitionId === competitionId)
      );
    if (!covering) {
      throw new DomainError(
        "forbidden",
        `${actor.kind} may not announcement.manage`
      );
    }
    return { role: "competition_manager" };
  }

  async recordAudit(
    _tx: unknown,
    { actor }: { actor: Actor },
    entry: AnnouncementAuditEntry
  ): Promise<void> {
    this.audits.push({ entry, actor });
  }

  async loadAudience(
    _db: unknown,
    competitionId: string
  ): Promise<AudienceSnapshot> {
    return this.#audiences.get(competitionId) ?? EMPTY_AUDIENCE;
  }

  async render(
    _db: unknown,
    channel: MessageChannel,
    variables: MessageVariables
  ): Promise<RenderedMessage> {
    this.rendered.push({ channel });
    const template = FAKE_TEMPLATES[channel];
    return {
      subject: fill(template.subject, variables),
      text: fill(template.text, variables),
    };
  }

  async deliver(
    _db: unknown,
    message: OutgoingMessage
  ): Promise<"sent" | "duplicate"> {
    if (this.#failures > 0) {
      this.#failures -= 1;
      throw new Error("FakeAnnouncementPorts: delivery failed");
    }
    if (this.#deliveredKeys.has(message.dedupeKey)) return "duplicate";
    this.#deliveredKeys.add(message.dedupeKey);
    this.delivered.push(message);
    return "sent";
  }

  recipientHash(key: string): string {
    return createHmac("sha256", "announcements-test-key")
      .update(key)
      .digest("hex");
  }
}

/** Content with every section filled except the closing message. */
export function sampleContent(
  overrides: Partial<AnnouncementContentInput> = {}
): AnnouncementContentInput {
  return {
    subject: "Phase 3: the drawing day",
    // 10:00 IST
    eventAt: new Date("2027-02-06T04:30:00.000Z"),
    confirmedTheme: "Street dogs of our city",
    permittedMaterials: "Pencils, crayons and watercolours on A3 paper",
    duration: "Two hours",
    submissionSteps:
      "Photograph your drawing in daylight.\nUpload it from your dashboard.",
    physicalArtworkRequirements: "Post the original drawing to the FOA office.",
    deadlines: "Uploads close on 13 February 2027 at 11:59 pm IST.",
    helpContacts: "Write to competitions@foa.example",
    message: null,
    ...overrides,
  };
}

export async function announcementWorld(h: Harness) {
  const ports = new FakeAnnouncementPorts();
  const useCases = announcementUseCasesWith(() => ports);
  const competitionId = uuidv7(h.clock.now());
  const otherCompetitionId = uuidv7(h.clock.now());

  function actorFor(userId: string): Actor {
    return {
      kind: "user",
      userId,
      sessionId: uuidv7(h.clock.now()),
      meta: { ip: "203.0.113.20", userAgent: "Seam 1 test" },
    };
  }

  /** A signed-in user holding `grants`. */
  async function userWith(...grants: FakeGrant[]): Promise<Actor> {
    const member = await h.seed.member();
    for (const grant of grants) ports.grant(member.id, grant);
    return actorFor(member.id);
  }

  const world = {
    ports,
    competitionId,
    otherCompetitionId,
    as: (actor: Actor) => useCases({ ...h.deps, actor }),
    userWith,
    /** A competition manager: global, or for one competition. */
    manager: (scope: { competitionId: string } | "global" = "global") =>
      userWith(
        scope === "global"
          ? { role: "competition_manager" }
          : { role: "competition_manager", competitionId: scope.competitionId }
      ),
    /** A draft on this world's competition; returns its id. */
    async draft(
      actor: Actor,
      overrides: Partial<AnnouncementContentInput> = {}
    ): Promise<string> {
      const created = await world.as(actor).createAnnouncement({
        competitionId,
        content: sampleContent(overrides),
      });
      if (!created.ok) throw new Error(`No draft: ${created.error}`);
      return created.announcement.id;
    },
  };
  return world;
}
