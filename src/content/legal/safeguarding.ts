import { type LegalDoc, POLICIES_UPDATED } from "./model";

// From SPEC §12.7–12.9 and ux-patterns P06. The public report form needs a
// back end (later), so this page names an interim channel (placeholders).
export const safeguarding: LegalDoc = {
  updated: POLICIES_UPDATED,
  short: [
    ["If you are in danger right now, call 112."],
    ["You can call Childline on 1098 at any time, for free."],
    [
      "If someone online makes you feel unsafe, tell a grown-up you trust. They can report it at cybercrime.gov.in or call 1930.",
    ],
    [
      "You can tell us too. You will not be in trouble for telling. We will listen, and we will help.",
    ],
  ],
  sections: [
    {
      id: "our-promise",
      title: "Our promise",
      blocks: [
        {
          p: [
            "Every child who takes part in Friends of Animals should be safe, and feel safe. We design for it: there are no messages, comments or follows between users; a child’s details are never shown in public beyond a first name and initial, an age group and a state; and every adult who works with children for us is checked first.",
          ],
        },
      ],
    },
    {
      id: "what-to-report",
      title: "What you can tell us about",
      blocks: [
        {
          list: [
            [
              "A child who may be hurt, or at risk of harm, at home, at school or online.",
            ],
            [
              "An adult, including anyone from Friends of Animals, behaving in a way that worries you.",
            ],
            [
              "Bullying, or unkind or unwanted contact connected with our competitions.",
            ],
            [
              "A child’s personal details, face or photo shown where they shouldn’t be.",
            ],
            ["Anything on this website that a child shouldn’t see."],
          ],
        },
      ],
    },
    {
      id: "how-to-report",
      title: "How to raise a concern",
      blocks: [
        {
          p: [
            "If a child is in danger now, call 112 first. Then tell us. Until our online report form is ready, write to ",
            { fact: "email" },
            " with “Safeguarding” in the subject, or call ",
            { fact: "phone" },
            ".",
          ],
        },
        {
          p: [
            "You don’t have to give your name, and you don’t need an account. If you can, tell us what happened, when and where, and who was involved, using the words you remember. Don’t try to investigate it yourself, and don’t confront anyone.",
          ],
        },
      ],
    },
    {
      id: "what-happens-next",
      title: "What happens next",
      blocks: [
        {
          list: [
            [
              "Our Designated Safeguarding Lead reads every concern and decides how serious it is. Concerns that could mean a child is at risk are treated as urgent.",
            ],
            [
              "If abuse is suspected, we report it to the police or the Special Juvenile Police Unit, as the Protection of Children from Sexual Offences Act, 2012 requires. Sexual images of children are reported to the police or at cybercrime.gov.in, and removed at once.",
            ],
            [
              "Accounts or entries connected with a serious concern are suspended while we look into it.",
            ],
            [
              "Only the safeguarding team can see a report. Each look at a case is logged, and reports are never used for anything else.",
            ],
            [
              "If you gave us a way to reach you, we tell you when we have acted, as far as we safely can.",
            ],
          ],
        },
      ],
    },
    {
      id: "staying-safe-online",
      title: "Staying safe on this website",
      blocks: [
        {
          list: [
            [
              "No one can message a child through this website. If someone claiming to be from Friends of Animals contacts a child directly, tell us.",
            ],
            [
              "We never ask a child for a photo of themselves, a home address or a phone number.",
            ],
            [
              "Every public picture or piece of writing is checked by a person before it appears.",
            ],
            [
              "Every page that shows participants’ work has a way to report it.",
            ],
          ],
        },
      ],
    },
    {
      id: "adults",
      title: "Adults who work with us",
      blocks: [
        {
          p: [
            "Staff and volunteers who work with children accept our code of conduct and complete a police verification before they start, renewed every three years. Judges and school coordinators accept the code of conduct too. Our full rules are in the ",
            {
              link: "child protection policy",
              href: "/child-protection-policy",
            },
            ".",
          ],
        },
      ],
    },
  ],
};
