// Adoption listings racing on real PostgreSQL (`pnpm test:pg`), from
// separate connections:
//
// - a new animal whose slug another connection is inserting waits at the
//   unique index, then takes the next numbered slug instead of failing;
// - a move waits for another connection's lock on the listing and then
//   refuses a move its outcome no longer allows.

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPgWorld, type PgWorld } from "@/test/pg";

import { BRUNO } from "./testing";

let world: PgWorld;

beforeAll(() => {
  world = createPgWorld();
});

afterAll(async () => {
  await world.close();
});

type Other = Awaited<ReturnType<PgWorld["sql"]["reserve"]>>;

/**
 * Runs `act` while another connection holds an uncommitted change made by
 * `hold`, so `act` waits on a lock; then commits and returns its answer.
 */
async function raceAgainst(
  hold: (other: Other) => Promise<unknown>,
  act: () => Promise<unknown>
) {
  const other = await world.sql.reserve();
  try {
    await other`begin`;
    await hold(other);
    const acted = act();
    acted.catch(() => {});
    const first = await Promise.race([
      acted.then(
        () => "finished" as const,
        () => "finished" as const
      ),
      world.waitForLockWaiters(1).then(() => "waits" as const),
    ]);
    expect(first).toBe("waits");
    await other`commit`;
    return await acted;
  } finally {
    await other`rollback`.catch(() => {});
    other.release();
  }
}

async function representative() {
  const directory = await world.seed.directoryListing({ status: "verified" });
  return { ...directory, actor: await world.signedIn(directory.owner) };
}

describe("adoption listings on real Postgres", () => {
  it("takes the next slug when another animal commits the same name first", async () => {
    const tag = randomUUID().slice(0, 8);
    const name = `Bruno ${tag}`;
    const slug = `bruno-${tag}-dog-pune`;
    const rep = await representative();

    const result = await raceAgainst(
      (other) => other`
        insert into adoption_listing (
          id, directory_listing_id, slug, name, species, sex, birth_month,
          conditions, state, city, city_key, pin_code, status, created_at,
          updated_at
        ) values (
          ${randomUUID()}, ${rep.listingId}, ${slug}, 'Another', 'dog',
          'male', '2025-01-01', 'None.', 'maharashtra', 'Pune', 'pune',
          '411001', 'draft', now(), now()
        )
      `,
      () =>
        world.as(rep.actor).createAdoptionListing({
          directoryListingId: rep.listingId,
          ...BRUNO,
          name,
        })
    );

    expect(result).toEqual({
      ok: true,
      adoptionListingId: expect.any(String),
      slug: `${slug}-2`,
    });
  });

  it("waits for another move and then refuses one its outcome no longer allows", async () => {
    const rep = await representative();
    const created = await world.as(rep.actor).createAdoptionListing({
      directoryListingId: rep.listingId,
      ...BRUNO,
      name: `Kalu ${randomUUID().slice(0, 8)}`,
    });
    if (!created.ok) throw new Error(created.error);

    const result = await raceAgainst(
      (other) => other`
        update adoption_listing
        set status = 'withdrawn', closed_at = now()
        where id = ${created.adoptionListingId}
      `,
      () =>
        world
          .as(rep.actor)
          .publishAdoptionListing({
            adoptionListingId: created.adoptionListingId,
          })
    );

    expect(result).toEqual({ ok: false, error: "invalid_transition" });
  });
});
