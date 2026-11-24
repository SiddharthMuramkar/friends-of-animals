import type { LegalDoc } from "./model";

// DRAFT copy for the two declarations a volunteer applicant makes (#123):
// the safeguarding declaration and the code of conduct. FOA's designated
// safeguarding lead and counsel approve the final words (HR-55) and staff
// publish them through /admin/consent-documents; previews seed this text
// as version 1. Production has no version until FOA publishes one, so
// applying there is refused until then. They are not policy pages, so they
// are not in LEGAL_DOCS.

type DeclarationDraft = Pick<LegalDoc, "short" | "sections"> & {
  title: string;
};

export type VolunteerDeclarationDraftPurpose =
  | "volunteer_safeguarding_declaration"
  | "volunteer_code_of_conduct";

export const VOLUNTEER_DECLARATION_DRAFTS: Record<
  VolunteerDeclarationDraftPurpose,
  DeclarationDraft
> = {
  volunteer_safeguarding_declaration: {
    title: "Volunteer safeguarding declaration (draft)",
    short: [
      ["You tell us the truth about anything that could put a child at risk."],
      ["Volunteers who work with children in person may need a police check."],
      ["You report any worry about a child's safety straight away."],
    ],
    sections: [
      {
        id: "what-you-declare",
        title: "What you declare",
        blocks: [
          {
            p: [
              "You have not been convicted of, charged with or cautioned for any offence against a child, and no court or authority has barred you from working with children.",
            ],
          },
          {
            p: [
              "You will tell Friends of Animals at once if anything changes. Draft text: FOA's safeguarding lead confirms the final words.",
            ],
          },
        ],
      },
      {
        id: "police-checks",
        title: "Police checks",
        blocks: [
          {
            p: [
              "If you will meet children in person, Friends of Animals may ask you for a police verification certificate before you start.",
            ],
          },
        ],
      },
      {
        id: "reporting-concerns",
        title: "Reporting a concern",
        blocks: [
          {
            p: [
              "If you are worried about a child's safety, report it straight away through ",
              { link: "Report a concern", href: "/safeguarding/report" },
              ". In an emergency call 112, or Childline on 1098.",
            ],
          },
        ],
      },
    ],
  },
  volunteer_code_of_conduct: {
    title: "Volunteer code of conduct (draft)",
    short: [
      ["Be kind to people and animals."],
      ["Never contact a child privately."],
      ["Keep what you learn about people to yourself."],
    ],
    sections: [
      {
        id: "how-you-behave",
        title: "How you behave",
        blocks: [
          {
            list: [
              ["Treat everyone, and every animal, with kindness and respect."],
              [
                "Never contact a child privately, by message, phone or social media. Talk to children only through Friends of Animals, with another adult present.",
              ],
              [
                "Never share photos, names or details of children or anyone you meet through Friends of Animals.",
              ],
            ],
          },
        ],
      },
      {
        id: "if-something-goes-wrong",
        title: "If something goes wrong",
        blocks: [
          {
            p: [
              "Friends of Animals may end your volunteering if you break this code. Draft text: FOA confirms the final words.",
            ],
          },
        ],
      },
    ],
  },
};
