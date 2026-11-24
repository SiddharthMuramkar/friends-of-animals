// Directory listings racing on real PostgreSQL (`pnpm test:pg`), from
// separate connections:
//
// - a registration whose slug another connection is inserting waits at the
//   unique index, then takes the next numbered slug instead of failing;
// - a person's second registration racing their first is refused as
//   `already_registered`, never thrown;
// - a staff decision waits for another's lock and then sees its outcome.

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPgWorld, type PgWorld } from "@/test/pg";

import { validListing } from "./testing";

let world: PgWorld;

beforeAll(() => {
  world = createPgWorld();
});

afterAll(async () => {
  await world.close();
});

async function member() {
  const account = await world.seed.member({ email: world.uniqueEmail() });
  return { account, actor: await world.signedIn(account) };
}

/** A name no earlier run of this file has used, and its slug. */
function freshName() {
  const tag = randomUUID().slice(0, 8);
  return { name: `Race Paws ${tag}`, slug: `race-paws-${tag}` };
}

/**
 * Runs `act` while another connection holds an uncommitted change made by
 * `hold`, so `act` waits on a lock; then commits the change and returns
 * what `act` answered.
 */
async function raceAgainst(
  hold: (
    other: Awaited<ReturnType<PgWorld["sql"]["reserve"]>>
  ) => Promise<unknown>,
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

/** Inserts a pending listing on `other`, as another registration would. */
function insertListing(
  owner: string,
  slug: string,
  status = "pending_verification"
) {
  return (other: Awaited<ReturnType<PgWorld["sql"]["reserve"]>>) => other`
    insert into directory_listing (
      id, slug, type, name, description, services, address_ciphertext,
      city, state, pin_code, contact_phone_ciphertext, public_contact_fields,
      status, status_changed_at, owner_user_id, created_at, updated_at
    ) values (
      ${randomUUID()}, ${slug}, 'ngo', 'Another listing', 'Another.',
      '{rescue}', 'sealed', 'Pune', 'Maharashtra', '411001', 'sealed', '{}',
      ${status}, now(), ${owner}, now(), now()
    )
  `;
}

describe("registerListing on real Postgres", () => {
  it("takes the next slug when another registration commits its name first", async () => {
    const { name, slug } = freshName();
    const someone = await member();
    const { actor } = await member();

    const result = await raceAgainst(
      insertListing(someone.account.id, slug),
      () => world.as(actor).registerListing(validListing({ name }))
    );

    expect(result).toEqual({
      ok: true,
      listingId: expect.any(String),
      slug: `${slug}-2`,
    });
  });

  it("refuses a person's second open listing while their first commits", async () => {
    const { name, slug } = freshName();
    const { account, actor } = await member();

    const result = await raceAgainst(
      insertListing(account.id, `${slug}-first`),
      () => world.as(actor).registerListing(validListing({ name }))
    );

    expect(result).toEqual({ ok: false, error: "already_registered" });
  });
});

describe("staff decisions on real Postgres", () => {
  it("waits for another decision and then refuses a move its outcome no longer allows", async () => {
    const { name } = freshName();
    const { actor } = await member();
    const registered = await world
      .as(actor)
      .registerListing(validListing({ name }));
    if (!registered.ok) throw new Error(`Refused: ${registered.error}`);
    const staffAccount = await world.seed.member({
      email: world.uniqueEmail(),
    });
    await world.seed.grant(staffAccount, {
      role: "staff_admin",
      scope: { type: "global" },
    });
    await world.seed.authenticator(staffAccount);
    const staff = await world.signedIn(staffAccount, { secondFactor: true });

    const result = await raceAgainst(
      (other) => other`
        update directory_listing
        set status = 'rejected', status_reason = 'Rejected first.'
        where id = ${registered.listingId}
      `,
      () =>
        world.as(staff).verifyListing({
          listingId: registered.listingId,
          reason: "Verified second.",
        })
    );

    expect(result).toEqual({ ok: false, error: "transition_not_allowed" });
  });
});
