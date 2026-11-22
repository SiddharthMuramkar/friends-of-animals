import { type LegalDoc, POLICIES_UPDATED } from "./model";

// Covers registration and fees, refunds, consent and minors. Fee amounts stay
// placeholders (SITE.org.fees).
export const terms: LegalDoc = {
  updated: POLICIES_UPDATED,
  short: [
    ["Be kind and honest here: no harmful, unlawful or copied content."],
    [
      "Anyone under 18 takes part with a parent’s or guardian’s permission, through a school or on their own.",
    ],
    [
      "Your artwork, writing, photos and films stay yours. You let us show them only in the ways you choose.",
    ],
    [
      "Judges see an entry code, not your name, school or city. Every participant gets a certificate.",
    ],
    [
      "Fees, if any, are shown before you pay. Refunds follow our refunds policy, and are automatic if a competition is cancelled.",
    ],
  ],
  sections: [
    {
      id: "about",
      title: "About these terms",
      blocks: [
        {
          p: [
            "These terms are an agreement between you and Friends of Animals",
            { clause: [" (registered name: ", { fact: "legalName" }, ")"] },
            " for using this website and taking part in our programmes. Please read them with our ",
            { link: "privacy policy", href: "/privacy" },
            " and ",
            { link: "safeguarding page", href: "/safeguarding" },
            ". If you are under 18, please read them with a parent or guardian.",
          ],
        },
      ],
    },
    {
      id: "using-the-site",
      title: "Using this website",
      blocks: [
        { p: ["When you use this website, please don’t:"] },
        {
          list: [
            ["post or send anything unlawful, hurtful, hateful or sexual;"],
            [
              "share anyone else’s personal details, or try to contact a child through us;",
            ],
            [
              "pretend to be someone else, or enter someone else’s work as your own;",
            ],
            [
              "try to break, overload or copy the site or its data, including by automated scraping.",
            ],
          ],
        },
        {
          p: [
            "This website has no messages, comments or follows between users, by design. Adults reach a child only through our staff or the child’s own school, and those messages go to the guardian.",
          ],
        },
      ],
    },
    {
      id: "taking-part",
      title: "Taking part in a competition",
      blocks: [
        {
          p: [
            "Each competition has its own page with its theme, categories, age groups, dates and rules. Those rules form part of these terms.",
          ],
        },
        {
          list: [
            [
              "You can enter through your school or institution (recommended), or on your own. No one has to go through a school.",
            ],
            [
              "For a participant under 18, a parent or lawful guardian must register them, or confirm the registration, and give consent.",
            ],
            [
              "Each participant may register once per competition. Duplicate registrations are cancelled.",
            ],
            [
              "Your entry must be your own work. In photos and films, don’t show the faces of other children, or the faces of other people without their permission, and don’t show uniforms, name tags, house numbers or vehicle plates.",
            ],
            [
              "Never hurt, frighten or disturb an animal to make an entry. Entries that do are removed.",
            ],
          ],
        },
      ],
    },
    {
      id: "your-work",
      title: "Your work stays yours",
      blocks: [
        {
          p: [
            "You keep the copyright in everything you create. By entering, you let us store and copy your entry so it can be judged. If you, or your guardian, agree to public display or social media, you also give us a non-exclusive, free licence to show the work for that competition, in our gallery and in awareness campaigns, always credited as you choose. You can withdraw that permission at any time (see the privacy policy).",
          ],
        },
        {
          p: [
            "If a competition asks for physical artwork, its page explains how originals are handled, displayed and returned.",
          ],
        },
      ],
    },
    {
      id: "judging",
      title: "Judging and recognition",
      blocks: [
        {
          p: [
            "Judges score entries against the rubric published for each competition. They see an entry code, the category, the age group and the work, never a name, school or city. Every participant whose entry is accepted receives a participation certificate. We may disqualify an entry that breaks these terms or the competition rules, and we will tell the participant, or their guardian, why.",
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
            "Any fee is shown on the competition page and at checkout before you pay. Schools may pay for their students together. A registration is confirmed once the consents are in place and any fee is paid or waived.",
          ],
        },
        {
          p: [
            "If we cancel a competition, or a registration turns out to be a duplicate, we refund the fee automatically. Other refunds follow our ",
            { link: "refunds policy", href: "/refunds" },
            ".",
          ],
        },
      ],
    },
    {
      id: "donations",
      title: "Donations",
      blocks: [
        {
          p: [
            "Only adults can donate. If you are under 18, please ask a grown-up. Donations are used for our charitable purposes. Receipt and tax details will be published on our donate page once they are confirmed.",
          ],
        },
      ],
    },
    {
      id: "information",
      title: "Stories and advice on this site",
      blocks: [
        {
          p: [
            "Our stories and tips are written with care and linked to their sources, but they are general information, not veterinary, medical or legal advice. If an animal is hurt, contact a vet or a local animal rescue. If a person is bitten, wash the wound with soap and running water for 15 minutes and see a doctor the same day.",
          ],
        },
      ],
    },
    {
      id: "liability",
      title: "Our responsibility",
      blocks: [
        {
          p: [
            "We work to keep this website accurate, safe and available, but we can’t promise it will always be free of errors or interruptions. Nothing in these terms limits any right you have under Indian law that cannot be limited.",
          ],
        },
      ],
    },
    {
      id: "law",
      title: "Law and disputes",
      blocks: [
        {
          p: [
            "These terms are governed by the laws of India.",
            {
              clause: [
                " If something goes wrong, please write to us first at ",
                { fact: "email" },
                " so we can try to put it right.",
              ],
            },
          ],
        },
      ],
    },
    {
      id: "changes",
      title: "Changes to these terms",
      blocks: [
        {
          p: [
            "When we change these terms, we update the date at the top. Changes don’t apply to a competition you have already entered unless the law requires it.",
          ],
        },
      ],
    },
  ],
};
