import { type LegalDoc, POLICIES_UPDATED } from "./model";

// Covers POCSO, how minors are displayed, designations, clearance,
// escalation and retention. The short version is the child-friendly summary
// (grade 6 or below, checked in legal.test.ts).
export const childProtection: LegalDoc = {
  updated: POLICIES_UPDATED,
  short: [
    ["This page is about how we keep you safe."],
    [
      "No one at Friends of Animals will ask to meet you alone, or to talk in secret.",
    ],
    ["We will not show your face, your home or your phone number to anyone."],
    [
      "Only your first name, your age group and your state can be shown, and only if your grown-up says yes.",
    ],
    [
      "If anything makes you feel unsafe, tell a grown-up you trust, or call Childline on 1098.",
    ],
  ],
  sections: [
    {
      id: "purpose",
      title: "Purpose and scope",
      blocks: [
        {
          p: [
            "This policy sets out how Friends of Animals (registered name: ",
            { fact: "legalName" },
            ") protects every child who takes part in our competitions, events and programmes. A child is anyone under 18.",
          ],
        },
        {
          p: [
            "It applies to everyone who acts for us: staff, volunteers, judges, partner school coordinators and anyone we work with who could come into contact with children or their data.",
          ],
        },
      ],
    },
    {
      id: "principles",
      title: "Our principles",
      blocks: [
        {
          list: [
            [
              "A child’s safety and well-being come before any other aim, including a competition or a campaign.",
            ],
            [
              "Every child is treated with equal respect, whatever their background, ability or school.",
            ],
            ["We collect and show as little about a child as we can."],
            [
              "Every concern is taken seriously and acted on. We never wait for proof before acting to keep a child safe.",
            ],
          ],
        },
      ],
    },
    {
      id: "roles",
      title: "Who is responsible",
      blocks: [
        {
          p: [
            "Our Designated Safeguarding Lead, with a deputy, receives and handles every concern, keeps the records and makes sure this policy is followed. Only they, and the most senior administrator, can see safeguarding cases. Everyone who acts for us is responsible for reporting a concern straight away.",
          ],
        },
      ],
    },
    {
      id: "safer-recruitment",
      title: "Checking the adults who work with us",
      blocks: [
        {
          list: [
            [
              "Staff, and volunteers with tasks involving children: our code of conduct and a cleared police verification, renewed every three years.",
            ],
            [
              "Judges: our code of conduct and a self-declaration; police verification for anyone judging in person.",
            ],
            [
              "School and institution coordinators: our code of conduct, with their institution vouching for them each academic year.",
            ],
          ],
        },
        {
          p: [
            "No one can see a child’s personal details until these checks are complete.",
          ],
        },
      ],
    },
    {
      id: "code-of-conduct",
      title: "Code of conduct",
      blocks: [
        { p: ["Everyone who acts for us must:"] },
        {
          list: [
            [
              "never contact a child directly, by phone, message or social media; all contact goes through the guardian or the child’s school;",
            ],
            ["never be alone and out of sight with a child at an event;"],
            [
              "never photograph or film a child without the guardian’s recorded consent;",
            ],
            [
              "never share a child’s details, or a child’s work, beyond what the guardian agreed to;",
            ],
            ["never give personal gifts or favours to a participant;"],
            [
              "use kind, respectful language, and never shame, threaten or single out a child;",
            ],
            [
              "report any concern about a child, or about another adult, the same day.",
            ],
          ],
        },
      ],
    },
    {
      id: "images-and-data",
      title: "Children’s images, work and data",
      blocks: [
        {
          p: [
            "In public we show at most a child’s first name and last initial, age group and state, and school or city only if the guardian chooses. We never show a child’s date of birth, exact age, address, phone, email or photograph. Judges see only an entry code. Hidden location and device data are removed from every image before anything is published, and a person checks every item before it goes public. Full details are in our ",
            { link: "privacy policy", href: "/privacy" },
            ".",
          ],
        },
      ],
    },
    {
      id: "responding",
      title: "Responding to a concern",
      blocks: [
        {
          list: [
            [
              "If a child tells you something worrying: stay calm, listen, and don’t promise to keep it secret. Write down what was said, in the child’s words, as soon as you can.",
            ],
            [
              "Don’t investigate, and don’t confront anyone. Pass it to the Designated Safeguarding Lead the same day. If a child is in immediate danger, call 112 first.",
            ],
            [
              "Where abuse is suspected, we report it to the police or the Special Juvenile Police Unit, as section 19 of the Protection of Children from Sexual Offences Act, 2012 requires. Sexual images of children are reported to the police or at cybercrime.gov.in.",
            ],
            [
              "An adult who is the subject of a concern is stood down from work with children while it is looked into.",
            ],
          ],
        },
        {
          p: [
            "Anyone can raise a concern, without an account and without giving their name: see our ",
            { link: "safeguarding page", href: "/safeguarding" },
            ".",
          ],
        },
      ],
    },
    {
      id: "records",
      title: "Records and confidentiality",
      blocks: [
        {
          p: [
            "Safeguarding records are kept securely, seen only by the safeguarding team, and shared only with the authorities who need them. We keep them for 7 years after a case closes, or until the child turns 25, whichever is later.",
          ],
        },
      ],
    },
    {
      id: "review",
      title: "Review",
      blocks: [
        {
          p: [
            "We review this policy every year, and after any serious incident. Questions about it can go to ",
            { fact: "email" },
            ".",
          ],
        },
      ],
    },
  ],
};
