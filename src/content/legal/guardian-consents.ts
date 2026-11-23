import type { LegalDoc, LegalSection } from "./model";

// DRAFT copy for the consents a parent or guardian gives for a child, one
// purpose at a time (#82). Counsel and FOA approve the final words (HR-33,
// HR-30) and staff publish them through /admin/consent-documents;
// previews seed this text as version 1 and attach it to the seeded
// competitions. They are not policy pages, so they are not in LEGAL_DOCS.
//
// Showing the school and the city are options of the public display
// document: they point at its version.

type ConsentDraft = Pick<LegalDoc, "short" | "sections"> & { title: string };

export type GuardianConsentDraftPurpose =
  | "participation"
  | "public_display"
  | "social_media"
  | "auction"
  | "communications";

const CHANGING_YOUR_MIND: LegalSection = {
  id: "changing-your-mind",
  title: "Changing your mind",
  blocks: [
    {
      p: [
        "You can withdraw this consent at any time on your child's consents page. We stop what it allowed as soon as we can.",
      ],
    },
  ],
};

export const GUARDIAN_CONSENT_DRAFTS: Record<
  GuardianConsentDraftPurpose,
  ConsentDraft
> = {
  participation: {
    title: "Consent for your child to take part",
    short: [
      ["Your child may take part in this competition."],
      ["We keep their details only to run it."],
      ["You can withdraw before the fee is paid."],
    ],
    sections: [
      {
        id: "what-you-agree-to",
        title: "What you agree to",
        blocks: [
          {
            p: [
              "As their parent or lawful guardian, you agree that your child may take part in this competition, by its rules, and that Friends of Animals keeps the details you gave to run it.",
            ],
          },
        ],
      },
      CHANGING_YOUR_MIND,
    ],
  },
  public_display: {
    title: "Consent to show your child's work in public",
    short: [
      ["Their work may be shown in the gallery and the results."],
      ["We credit them by first name and last initial."],
      ["School and city only if you choose each one."],
    ],
    sections: [
      {
        id: "what-you-agree-to",
        title: "What you agree to",
        blocks: [
          {
            p: [
              "Your child's artwork may be shown on the Friends of Animals website: in the competition's gallery and its results.",
            ],
          },
          {
            p: [
              "We credit them by first name and the first letter of their surname, such as Asha K. We add their school, or their city, only if you choose to show it.",
            ],
          },
        ],
      },
      CHANGING_YOUR_MIND,
    ],
  },
  social_media: {
    title: "Consent to share your child's work on social media",
    short: [
      ["Their work may be shared on Friends of Animals' social media."],
      ["Credited the same way as in the gallery."],
    ],
    sections: [
      {
        id: "what-you-agree-to",
        title: "What you agree to",
        blocks: [
          {
            p: [
              "Friends of Animals may share your child's artwork on its own social media accounts, credited as in the gallery.",
            ],
          },
        ],
      },
      CHANGING_YOUR_MIND,
    ],
  },
  auction: {
    title: "Consent to auction your child's artwork",
    short: [
      ["Their physical artwork may be auctioned to raise money for animals."],
      ["Credited by first name and last initial only."],
    ],
    sections: [
      {
        id: "what-you-agree-to",
        title: "What you agree to",
        blocks: [
          {
            p: [
              "If your child's physical artwork is chosen, Friends of Animals may auction it to raise money for animal welfare. Buyers see only their first name and last initial.",
            ],
          },
        ],
      },
      CHANGING_YOUR_MIND,
    ],
  },
  communications: {
    title: "Messages about your child",
    short: [
      ["We may send you news about competitions your child could enter."],
      ["Never adverts from other companies."],
    ],
    sections: [
      {
        id: "what-you-agree-to",
        title: "What you agree to",
        blocks: [
          {
            p: [
              "Friends of Animals may email you news about competitions and activities suited to your child.",
            ],
          },
        ],
      },
      CHANGING_YOUR_MIND,
    ],
  },
};
