// Whether an institution's coordinators can enrol or withdraw students
// right now (#75): while the competition's registration is open and the
// institution is verified. One answer, so enrolling, withdrawing and the
// dashboard's "Add a student" agree, with the same reason when they can't.
//
// Pure: the caller loads the facts.

import type { RegistrationWindow } from "./registration-window";

export type EnrolmentState =
  | "open"
  | "institution_not_verified"
  | "not_open_yet"
  | "closed";

export function enrolmentState(facts: {
  window: RegistrationWindow;
  /** The institution's status (#73); only "verified" may enrol. */
  institutionStatus: string;
}): EnrolmentState {
  // As for registering (./institution-registration.ts): the institution
  // first, then the window.
  if (facts.institutionStatus !== "verified") return "institution_not_verified";
  switch (facts.window) {
    case "open":
      return "open";
    case "not_open_yet":
      return "not_open_yet";
    // A registered competition was published; a draft fails safe.
    case "unpublished":
    case "closed":
      return "closed";
  }
}
