// Test helpers for the institutions module. Tests only: nothing in the app
// imports this file.

import type { Harness } from "@/test/harness";

import type { RegisterInstitutionInput } from "./domain/registration";

/** A registration that passes every check, as the form sends it. */
export function validRegistration(
  overrides: Partial<RegisterInstitutionInput> = {}
): RegisterInstitutionInput {
  return {
    name: "Sunrise Public School",
    type: "school",
    address: "12 Lake Road, Sector 4",
    pinCode: "411001",
    city: "Pune",
    state: "Maharashtra",
    country: "India",
    contactEmail: "office@sunrise-school.example.test",
    contactPhone: "+91 90000 00201",
    principalName: "Meera Kulkarni",
    principalEmail: "principal@sunrise-school.example.test",
    principalPhone: "090000 00202",
    expectedParticipants: 240,
    ...overrides,
  };
}

/**
 * A signed-in member who has registered an institution, and its id. Pass
 * `registration` to change what they send.
 */
export async function registeredInstitution(
  h: Harness,
  registration: Partial<RegisterInstitutionInput> = {}
) {
  const person = await h.seed.member();
  const actor = await h.signIn(person);
  const result = await h
    .as(actor)
    .registerInstitution(validRegistration(registration));
  if (!result.ok) {
    throw new Error(`Could not register an institution: ${result.error}`);
  }
  return { person, actor, institutionId: result.institutionId };
}

/** A signed-in user holding `role` globally (a staff admin, by default). */
export async function signedInStaff(
  h: Harness,
  role: "staff_admin" | "super_admin" = "staff_admin"
) {
  const user = await h.seed.member();
  await h.seed.grant(user, { role, scope: { type: "global" } });
  return h.signIn(user);
}
