// What signing one session out leaves the sessions page to say. It lives in
// the page's state (useActionState), never in the address, so no link,
// reload or return to the page can say it again.

export type SignOutState = {
  /**
   * Set when a device was just signed out, to a new value for each
   * sign-out, so a second one is announced (and takes focus) too.
   */
  noticeId: string | null;
};

/** Nothing to say: before any sign-out, or after one that found nothing. */
export const NO_NOTICE: SignOutState = { noticeId: null };
