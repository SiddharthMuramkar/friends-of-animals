// Whether a competition takes registrations right now (#75). The status,
// which the schedule moves (#71), says whether registration has opened.
// The clock only guards the close: if the worker runs late and the status
// still reads open after the closing instant, registration is closed
// anyway. A status this file does not know (a later stage, or cancelled)
// counts as closed, so statuses added later fail safe.
//
// Pure: the caller passes the time from the injected clock.

/** Where a competition stands for anyone who wants to register. */
export type RegistrationWindow =
  | "unpublished"
  | "not_open_yet"
  | "open"
  | "closed";

export type WindowFacts = {
  /** The competition's status, as #70a, #71 and later tickets name it. */
  status: string;
  /** The registration-close key date, if one is set. */
  registrationClosesAt: Date | null;
};

export function registrationWindow(
  facts: WindowFacts,
  now: Date
): RegistrationWindow {
  switch (facts.status) {
    case "draft":
      return "unpublished";
    case "published":
      return "not_open_yet";
    case "registration_open":
      return facts.registrationClosesAt !== null &&
        now.getTime() >= facts.registrationClosesAt.getTime()
        ? "closed"
        : "open";
    default:
      return "closed";
  }
}
