import type { LegalDoc } from "./model";

// DRAFT copy for an adopter's two consents (#130): sharing their contact
// details with the listing organisation when they apply, and sharing their
// success story. FOA approves the final words (HR-61) and staff publish
// them through /admin/consent-documents; previews seed this text as
// version 1. Production has no version until FOA publishes one, so
// applying there is refused until then. They are not policy pages, so they
// are not in LEGAL_DOCS.

type AdoptionConsentDraft = Pick<LegalDoc, "short" | "sections"> & {
  title: string;
};

export type AdoptionConsentDraftPurpose =
  | "adoption_contact_sharing"
  | "adoption_success_story";

export const ADOPTION_CONSENT_DRAFTS: Record<
  AdoptionConsentDraftPurpose,
  AdoptionConsentDraft
> = {
  adoption_contact_sharing: {
    title:
      "Sharing your contact details with the animal's organisation (draft)",
    short: [
      [
        "If our adoption coordinator thinks you could be a good match, we share your name, mobile, address and answers with the organisation that listed the animal.",
      ],
      ["They use them only to talk to you about this adoption."],
      [
        "The organisation, not Friends of Animals, is responsible for the animal.",
      ],
    ],
    sections: [
      {
        id: "what-we-share",
        title: "What we share, and when",
        blocks: [
          {
            p: [
              "Friends of Animals facilitates adoptions; it does not run a shelter. Our adoption coordinator reads your application first. Only if it looks like a good match do we share your name, mobile number, postal address and your answers with the organisation or rescuer who listed the animal, so they can contact you. Draft text: FOA confirms the final words.",
            ],
          },
        ],
      },
      {
        id: "how-long",
        title: "How long we keep it",
        blocks: [
          {
            p: [
              "We keep your application for two years after it closes, then delete it. You can withdraw an open application from your dashboard at any time.",
            ],
          },
        ],
      },
    ],
  },
  adoption_success_story: {
    title: "Sharing your adoption success story (draft)",
    short: [
      ["We may share your story on our website to inspire other adopters."],
      ["We never show your name or contact details."],
      ["You can withdraw at any time, and we take the story down."],
    ],
    sections: [
      {
        id: "what-we-show",
        title: "What we show",
        blocks: [
          {
            p: [
              "We show your words, the animal's name and the organisation that listed them on our adoption stories page. We never show your name, contact details or where you live. Our adoption coordinator reads the story before it goes up. Draft text: FOA confirms the final words.",
            ],
          },
        ],
      },
      {
        id: "withdrawing",
        title: "Withdrawing",
        blocks: [
          {
            p: [
              "You can withdraw your consent from your application's page on your dashboard. We take your story down straight away.",
            ],
          },
        ],
      },
    ],
  },
};
