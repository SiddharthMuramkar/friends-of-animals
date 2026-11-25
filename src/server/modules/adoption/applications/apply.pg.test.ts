// Adoption applications racing on real PostgreSQL (`pnpm test:pg`), from
// separate connections: an application made while the coordinator's
// adoption transaction holds the animal's listing waits for it, then finds
// the animal adopted and is refused, so no application stays open on an
// adopted animal.

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseConsentDocumentBody } from "@/server/modules/consent/domain/document-body";
import { insertConsentDocumentVersion } from "@/server/modules/consent/insert-version";
import { createPgWorld, type PgWorld } from "@/test/pg";

let world: PgWorld;

beforeAll(() => {
  world = createPgWorld();
});

afterAll(async () => {
  await world.close();
});

async function contactSharingDocument(): Promise<string> {
  const parsed = parseConsentDocumentBody({
    short: [["Draft contact sharing."]],
    sections: [
      {
        id: "what-you-agree",
        title: "What you agree to",
        blocks: [{ p: ["Draft text. Not FOA's words."] }],
      },
    ],
  });
  if (!parsed.ok) throw new Error(parsed.issues.join("; "));
  const { id } = await world.db.transaction((tx) =>
    insertConsentDocumentVersion(
      tx,
      { now: world.clock.now(), publishedByUserId: null },
      {
        purpose: "adoption_contact_sharing",
        title: null,
        body: parsed.body,
        legalRevisionId: null,
      }
    )
  );
  return id;
}

describe("adoption applications on real Postgres", () => {
  it("waits for an adoption being recorded, then refuses the application", async () => {
    const documentId = await contactSharingDocument();
    const directory = await world.seed.directoryListing({ status: "verified" });
    const listingId = randomUUID();
    const slug = `bruno-${randomUUID().slice(0, 8)}-dog-pune`;
    await world.sql`
      insert into adoption_listing (
        id, directory_listing_id, slug, name, species, sex, birth_month,
        conditions, state, city, city_key, pin_code, status, published_at,
        created_at, updated_at
      ) values (
        ${listingId}, ${directory.listingId}, ${slug}, 'Bruno', 'dog',
        'male', '2025-01-01', 'Indoor home.', 'maharashtra', 'Pune', 'pune',
        '411001', 'published', now(), now(), now()
      )
    `;
    const applicant = await world.signedIn(await world.seed.member());

    const other = await world.sql.reserve();
    try {
      await other`begin`;
      // The coordinator's adoption: it holds the listing's row lock.
      await other`
        update adoption_listing
        set status = 'adopted', closed_at = now()
        where id = ${listingId}
      `;
      const applying = world.as(applicant).applyToAdopt({
        slug,
        phone: "98765 43210",
        address: "Flat 4, Sunrise Apartments, Pune 411001",
        answers: {
          homeType: "flat",
          hasOutdoorSpace: false,
          otherAnimals: "",
          experience: "",
          whyThisAnimal: "A calm dog suits our flat.",
        },
        dateOfBirth: "1990-05-01",
        contactSharingDocumentId: documentId,
      });
      applying.catch(() => {});
      const first = await Promise.race([
        applying.then(
          () => "finished" as const,
          () => "finished" as const
        ),
        world.waitForLockWaiters(1).then(() => "waits" as const),
      ]);
      expect(first).toBe("waits");
      await other`commit`;
      expect(await applying).toEqual({ ok: false, error: "listing_not_open" });
    } finally {
      await other`rollback`.catch(() => {});
      other.release();
    }
    const open = await world.sql`
      select count(*)::int as n from adoption_application
      where adoption_listing_id = ${listingId}
    `;
    expect(open[0]?.n).toBe(0);
  });
});
