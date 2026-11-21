// Test helpers for the directory module. Tests only: nothing in the app
// imports this file.

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import type { Actor } from "@/server/actor";
import { createApp } from "@/server/app";
import type { Deps } from "@/server/deps";
import { createHarness, type Harness } from "@/test/harness";

import type { ListingCipher } from "./cipher";

/**
 * AES-256-GCM under a fresh key, with the purpose bound in as additional
 * data, standing in for #58's field cipher until the harness holds it.
 */
export function testListingCipher(): ListingCipher {
  const key = randomBytes(32);
  return {
    encrypt(purpose, plaintext) {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      cipher.setAAD(Buffer.from(purpose));
      const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      return [iv, body, cipher.getAuthTag()]
        .map((part) => part.toString("base64url"))
        .join(":");
    },
    decrypt(purpose, stored) {
      const [iv, body, tag] = stored
        .split(":")
        .map((part) => Buffer.from(part, "base64url"));
      if (!iv || !body || !tag) throw new Error("Not a stored value");
      const decipher = createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAAD(Buffer.from(purpose));
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(body), decipher.final()]).toString(
        "utf8"
      );
    },
  };
}

export type DirectoryHarness = Harness & { cipher: ListingCipher };

/**
 * The Seam 1 harness, with `as(actor)` over deps that hold a field cipher.
 * Once #58 puts `cipher` in the harness's own deps, this becomes plain
 * `createHarness()`.
 */
export async function createDirectoryHarness(
  options: { now?: Date | string } = {}
): Promise<DirectoryHarness> {
  const h = await createHarness(options);
  const cipher = testListingCipher();
  const deps: Deps & { cipher: ListingCipher } = { ...h.deps, cipher };
  const app = createApp(deps);
  return { ...h, deps, cipher, as: (actor: Actor) => app.as(actor) };
}

/** A valid registration: an NGO in Pune that shows its email and website. */
export const PAWS_TRUST = {
  type: "ngo",
  name: "Paws Trust",
  description: "We rescue and treat street animals in Pune.",
  services: ["veterinary_care", "rescue"],
  address: "12 Lane 4, Koregaon Park",
  city: "Pune",
  state: "Maharashtra",
  pinCode: "411001",
  contactPhone: "98765 43210",
  contactEmail: "Hello@PawsTrust.example",
  website: "pawstrust.example",
  publicContactFields: ["email", "website"],
} as const;

/** A signed-in member, a staff admin and a super admin. */
export async function directoryActors(h: Harness) {
  const staffUser = await h.seed.member({ name: "Meera Staff" });
  await h.seed.grant(staffUser, {
    role: "staff_admin",
    scope: { type: "global" },
  });
  const ownerUser = await h.seed.member({ name: "Asha Owner" });
  return {
    ownerUser,
    owner: await h.signIn(ownerUser),
    otherMember: await h.signIn(await h.seed.member()),
    staffUser,
    staffAdmin: await h.signIn(staffUser),
    superAdmin: await h.signIn(await h.seed.superAdmin()),
    visitor: h.visitor(),
  };
}
