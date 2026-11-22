import type { LegalDoc } from "./model";

// DRAFT copy for a competition's terms (#72). Counsel and FOA write the
// real words (HR-33), and staff publish them as the competition_terms
// consent document through /admin/consent-documents. Previews seed this
// text as version 1 so a competition has terms to attach; the text says
// it is a draft. Production gets no seed.
export const COMPETITION_TERMS_DRAFT: Pick<LegalDoc, "short" | "sections"> & {
  title: string;
} = {
  title: "Competition terms (draft)",
  short: [
    ["This is draft text for previews, not Friends of Animals' terms."],
    ["Each competition's page lists its rules, dates and fees."],
    ["You agree to the exact version linked from that page."],
  ],
  sections: [
    {
      id: "draft",
      title: "About this draft",
      blocks: [
        {
          p: [
            "Friends of Animals and its lawyers will write the real competition terms. Until then, previews show this draft so the pages can be tried out.",
          ],
        },
      ],
    },
    {
      id: "taking-part",
      title: "Taking part",
      blocks: [
        {
          p: [
            "The competition's page sets out who may enter, what to make and the dates that apply. Registering means agreeing to the version of these terms linked from that page.",
          ],
        },
      ],
    },
    {
      id: "fees-and-refunds",
      title: "Fees and refunds",
      blocks: [
        {
          p: [
            "Any fee is shown on the competition's page before you register. ",
            { link: "How refunds work", href: "/refunds" },
            " is on its own page.",
          ],
        },
      ],
    },
    {
      id: "your-data",
      title: "Your data",
      blocks: [
        {
          p: [
            "The ",
            { link: "privacy policy", href: "/privacy" },
            " explains what we collect for a competition and why.",
          ],
        },
      ],
    },
  ],
};
