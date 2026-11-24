// The Seam 1 entry point. Server actions and route handlers call
//
//   await as(actor).someUseCase(input)
//
// and Seam 1 tests call the same use cases through the harness
// (src/test/harness.ts), which builds the app over PGlite, a fake clock and
// in-memory fakes with `createApp(deps)`.
//
// Each module adds one entry to `useCases` below.

import "server-only";

import { headers } from "next/headers";

import { accessUseCases } from "./access";
import type { Actor } from "./actor";
import { auditUseCases } from "./audit";
import { cmsUseCases } from "./modules/cms";
import { consentLinksUseCases } from "./modules/consent-links";
import { consentUseCases } from "./modules/consent";
import { consentFormUseCases } from "./modules/consent-forms";
import { productionDeps, type Deps } from "./deps";
import { identityUseCases, resolveActor } from "./identity";
import { competitionsUseCases } from "./modules/competitions";
import { notificationsUseCases } from "./modules/notifications";
import { secondFactorUseCases } from "./modules/second-factor";
import { filesUseCases } from "./modules/files";
import { settingsUseCases } from "./modules/settings";
import { institutionUseCases } from "./modules/institutions";
import { coordinatorsUseCases } from "./modules/institutions/coordinators";
import { contactUseCases } from "./modules/contact";
import { publicFormUseCases } from "./modules/public-forms";
import { safeguardingUseCases } from "./modules/safeguarding";
import { judgingUseCases } from "./modules/judging";
import { competitionTermsUseCases } from "./modules/competitions/terms";
import { registrationUseCases } from "./modules/registration";
import { paymentsUseCases } from "./modules/payments";
import { participantsUseCases } from "./modules/participants";
import { guardiansUseCases } from "./modules/guardians";
import { ledgerUseCases } from "./modules/ledger";
import { entriesUseCases } from "./modules/entries";
import { announcementsUseCases } from "./modules/announcements";
import { privacyUseCases } from "./modules/privacy";
import { breachesUseCases } from "./modules/breaches";
import { volunteersUseCases } from "./modules/volunteers";
import { remindersUseCases } from "./modules/reminders";
import { composeUseCases } from "./use-cases";

const useCases = composeUseCases(
  identityUseCases,
  accessUseCases,
  auditUseCases,
  secondFactorUseCases,
  filesUseCases,
  settingsUseCases,
  consentUseCases,
  consentFormUseCases,
  consentLinksUseCases,
  competitionsUseCases,
  cmsUseCases,
  notificationsUseCases,
  institutionUseCases,
  coordinatorsUseCases,
  publicFormUseCases,
  contactUseCases,
  safeguardingUseCases,
  judgingUseCases,
  competitionTermsUseCases,
  registrationUseCases,
  paymentsUseCases,
  participantsUseCases,
  guardiansUseCases,
  ledgerUseCases,
  entriesUseCases,
  announcementsUseCases,
  privacyUseCases,
  breachesUseCases,
  volunteersUseCases,
  remindersUseCases
);

/** Every use case, by name, bound to one actor. */
export type UseCases = ReturnType<typeof useCases>;

export type App = {
  /** The use cases, acting as `actor`. */
  as(actor: Actor): UseCases;
};

export function createApp(deps: Deps): App {
  return { as: (actor) => useCases({ ...deps, actor }) };
}

/** The production app's use cases, acting as `actor`. */
export function as(actor: Actor): UseCases {
  return createApp(productionDeps()).as(actor);
}

/**
 * Who is making the current request: the signed-in user or a visitor.
 * Reads the request's cookies, so a Server Component calls it under
 * <Suspense>, never at a layout's top level.
 */
export async function currentActor(): Promise<Actor> {
  // headers() first: while prerendering it postpones the render here,
  // before productionDeps() reads the runtime config, which a build lacks.
  const requestHeaders = await headers();
  return resolveActor(productionDeps(), requestHeaders);
}
