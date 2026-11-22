// Who a participant's profile belongs to, and which way a registration
// came in (#75). One profile table serves every route: a school keeps its
// students' profiles (this ticket), an adult keeps their own (#78) and a
// guardian a child's (#81), each adding its owner column and check. All
// three owners exist in the enum from the start, so no later ticket has to
// add a value and use it in the same migration run (rule F2).
//
// Plain TypeScript with no imports, so the schema file and the seed
// script can load it under plain Node.

export const PARTICIPANT_OWNER_KINDS = [
  "institution",
  "self",
  "guardian",
] as const;

export type ParticipantOwnerKind = (typeof PARTICIPANT_OWNER_KINDS)[number];

/** Through a school's registration (#75), or on their own (#78). */
export const REGISTRATION_ROUTES = ["institution", "individual"] as const;

export type RegistrationRoute = (typeof REGISTRATION_ROUTES)[number];
