// Who receives a message, as an audience resolves it: a user id (every
// channel the route names), a user limited to the inbox, or a user who must
// be told nothing, with why (the dispatcher records each wanted channel as
// suppressed). Shared by the audiences (../audiences.ts) and the modules
// that resolve one for them (../../guardians/participant-audience.ts).
//
// Pure types: no imports, no "server-only".

export type AudienceMember =
  | string
  | { userId: string; channels: "in_app_only" }
  | { userId: string; suppressed: "no_guardian" };
