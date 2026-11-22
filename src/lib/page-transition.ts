import type { ViewTransitionClassPerType } from "react";

/**
 * The transition type every link to another page carries (SiteLink). The
 * root layout's <ViewTransition> cross-fades for it and nothing else.
 *
 * Nothing else may start a view transition. From the commit that starts one
 * until the browser runs its update callback (a frame at least, longer on a
 * busy device), React ignores every event, then puts focus back where it
 * was when the commit began: a click is lost, and typing lands in the field
 * before. Untyped, a part of the page streaming in, a form's reply, a
 * refresh, or Back and Forward would each start one while the visitor is
 * using the page (tests/e2e/page-transitions.spec.ts).
 */
export const PAGE_NAVIGATION = "page-navigation";

/** The root layout's view transition classes: a cross-fade for a link only. */
export const PAGE_TRANSITION_CLASS = {
  [PAGE_NAVIGATION]: "auto",
  default: "none",
} satisfies ViewTransitionClassPerType;
