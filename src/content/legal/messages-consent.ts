import type { LegalDoc } from "./model";

// DRAFT copy for the messages consent document (#64). Counsel and FOA
// approve the final words (HR-20) and staff publish them through
// /admin/consent-documents; previews seed this text as version 1. It is
// not a policy page, so it is not in LEGAL_DOCS.
//
// "Messages" means optional news and updates only. Service messages
// (sign-in codes, receipts, notices the law requires) never depend on it.
export const MESSAGES_CONSENT_DRAFT: Pick<LegalDoc, "short" | "sections"> & {
  title: string;
} = {
  title: "News and updates by email",
  short: [
    ["We email you news about competitions, results and animal care."],
    ["About two emails a month. Never adverts from other companies."],
    ["You can stop them at any time, in your account settings."],
  ],
  sections: [
    {
      id: "what-you-get",
      title: "What you agree to",
      blocks: [
        {
          p: [
            "If you say yes, Friends of Animals emails you news and updates: new competitions, results, stories and tips on caring for animals.",
          ],
        },
        {
          p: [
            "We send them to the email address on your account. We don't share your address with anyone to send you their own messages.",
          ],
        },
      ],
    },
    {
      id: "what-it-does-not-cover",
      title: "What this doesn't cover",
      blocks: [
        {
          p: [
            "Some emails are part of using your account, so we send them whether or not you agree to news and updates:",
          ],
        },
        {
          list: [
            ["sign-in codes"],
            ["receipts for payments"],
            ["notices the law requires us to send"],
          ],
        },
      ],
    },
    {
      id: "changing-your-mind",
      title: "Changing your mind",
      blocks: [
        {
          p: [
            "You can withdraw at any time on the ",
            { link: "consent settings page", href: "/account/consents" },
            ". We stop sending news and updates as soon as you do. Withdrawing doesn't affect anything else about your account.",
          ],
        },
        {
          p: ["Questions? Write to ", { fact: "email" }, "."],
        },
      ],
    },
  ],
};
