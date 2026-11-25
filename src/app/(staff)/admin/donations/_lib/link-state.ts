// The receipt link form's state (#106): the link finance just made, shown
// in the page, never in a URL. Pure, so the form and the action share it.

export type LinkFormState = {
  attempt: number;
  /** The new link's path, and "valid until …" in words. */
  link?: { path: string; validUntil: string };
  problem?: "cancelled" | "failed";
};

export const LINK_START: LinkFormState = { attempt: 0 };
