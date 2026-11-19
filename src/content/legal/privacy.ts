import { type LegalDoc, POLICIES_UPDATED } from "./model";

// Covers personal data, consent, rights and cookieless analytics. Periods are
// the published defaults: grievances acknowledged in 48 hours, resolved in 30
// days.
export const privacy: LegalDoc = {
  updated: POLICIES_UPDATED,
  short: [
    [
      "If you only visit this website, we collect nothing about you: no tracking cookies, no ads, no pixels. We count visits only as totals.",
    ],
    [
      "When someone takes part, we collect only what a competition needs: a name, date of birth, place and school, and a guardian’s contact for anyone under 18.",
    ],
    [
      "A parent or guardian must agree before we use a child’s details. Nothing is shown publicly unless you choose it, and then only a first name and initial, an age group and a state.",
    ],
    [
      "We never sell personal data, and we never track or advertise to children.",
    ],
    [
      "You can see, correct or delete your data, and change your choices at any time. Ask our grievance officer; we reply within 48 hours and resolve within 30 days.",
    ],
  ],
  sections: [
    {
      id: "who-we-are",
      title: "Who we are",
      blocks: [
        {
          p: [
            "Friends of Animals (registered name: ",
            { fact: "legalName" },
            ") runs this website and its programmes. We decide why and how your personal data is used, which makes us the “data fiduciary” under India’s Digital Personal Data Protection Act, 2023. Our postal address is ",
            { fact: "address" },
            ".",
          ],
        },
        {
          p: [
            "We built our systems to the standard of that Act and its Rules from the first day, including the parts that come into force later.",
          ],
        },
      ],
    },
    {
      id: "visitors",
      title: "If you are just visiting",
      blocks: [
        {
          p: [
            "Reading this website needs no account and no personal data. We use no advertising or tracking cookies, no third-party pixels, no session recording and no fingerprinting. If we measure visits, we use privacy-friendly analytics that only count totals (for example, how many people opened a page) and store nothing that identifies you.",
          ],
        },
        {
          p: [
            "Our servers keep short technical logs (such as the time of a request and an IP address) to keep the site secure, as the law requires. These logs are kept for 365 days and then deleted.",
          ],
        },
        {
          p: [
            "Some features, like the drawing pad and the pledge card, run only in your browser. What you draw or type there never reaches us.",
          ],
        },
      ],
    },
    {
      id: "what-we-collect",
      title: "What we collect when you take part",
      blocks: [
        { p: ["We collect only what each activity needs."] },
        {
          list: [
            [
              { strong: "Participants (any route):" },
              " full name, a display name, date of birth, PIN code, city, state and country, and school or institution.",
            ],
            [
              { strong: "Adult participants:" },
              " a phone number, and an email address if you choose to give one.",
            ],
            [
              { strong: "Parents and guardians of participants under 18:" },
              " name, relationship to the child, phone number, email if given, year of birth, and a declaration that you are an adult and the child’s parent or lawful guardian.",
            ],
            [
              { strong: "Schools and institutions:" },
              " the institution’s details and address, and the names and work contact details of the principal and the coordinator.",
            ],
            [
              { strong: "Judges and volunteers:" },
              " name, contact details, declarations of any conflict of interest, and the safeguarding checks described in our ",
              {
                link: "child protection policy",
                href: "/child-protection-policy",
              },
              ".",
            ],
            [
              { strong: "Donors:" },
              " what the payment needs, plus PAN and address only if you ask for a receipt that requires them.",
            ],
          ],
        },
        {
          p: [
            "We never collect a child’s photograph, Aadhaar or any identity document, or a full home address, and we don’t ask for gender unless a competition truly needs it.",
          ],
        },
      ],
    },
    {
      id: "why",
      title: "Why we use it",
      blocks: [
        {
          list: [
            [
              "To check that an entry is eligible and place it in the right age group.",
            ],
            ["To run judging, publish results and issue certificates."],
            [
              "To contact a participant, or the guardian of a participant under 18, about their entry.",
            ],
            ["To verify schools and coordinators."],
            ["To issue receipts and keep accounts the law requires."],
            ["To keep children safe and respond to safeguarding concerns."],
            [
              "To send news about future competitions, only if you agree to it.",
            ],
          ],
        },
      ],
    },
    {
      id: "children",
      title: "Children’s data",
      blocks: [
        {
          p: [
            "Under the Act, anyone under 18 is a child. We need the verifiable consent of a parent or lawful guardian before we use a child’s data. On the individual route the guardian confirms it from their own phone or email; on the school route the school collects signed forms from guardians, and we ask the guardian to confirm by SMS.",
          ],
        },
        {
          p: [
            "We never track children, monitor their behaviour or show them targeted advertising, even if a guardian agrees.",
          ],
        },
        {
          p: [
            "If a child’s work is shown in public, we show only a first name and last initial (for example “Aarav S.”), the age group and the state. We never show a child’s date of birth, exact age, address, PIN code, phone, email or photograph. School and city appear only if the guardian chooses. Judges see an entry code, never a name, school or city.",
          ],
        },
        {
          p: [
            "When a participant turns 18, we invite them to take over their own account and confirm their choices themselves.",
          ],
        },
      ],
    },
    {
      id: "choices",
      title: "Your choices and consent",
      blocks: [
        {
          p: [
            "Each optional use has its own tick box. None is ticked for you, saying no is as easy as saying yes, and saying no never stops anyone taking part or being judged. Optional uses are: showing work in the public gallery or results, sharing it on social media, photos or video at an event, and news by message or email.",
          ],
        },
        {
          p: [
            "You can withdraw a choice at any time, as easily as you gave it. If you withdraw permission to show work in public, we take it down within 24 hours. Withdrawing doesn’t undo what was done lawfully before, and we can’t recall copies other people have already shared.",
          ],
        },
      ],
    },
    {
      id: "sharing",
      title: "Who we share it with",
      blocks: [
        {
          p: [
            "We do not sell or rent personal data. We share it only with service providers who help us run the platform (hosting, email and SMS, payments), under contracts that let them use it only on our instructions, and with authorities when the law requires it, for example to report harm to a child.",
          ],
        },
      ],
    },
    {
      id: "security",
      title: "How we keep it safe",
      blocks: [
        {
          p: [
            "Sensitive details such as dates of birth and guardians’ phone numbers are encrypted. Access is limited to the people who need it, and is logged. Photos and documents are stripped of hidden location and device data before anything is shown publicly.",
          ],
        },
        {
          p: [
            "If a data breach ever affects you, we will tell you and the Data Protection Board of India without delay, explain what happened and what you can do, and send the Board a full report within 72 hours.",
          ],
        },
      ],
    },
    {
      id: "retention",
      title: "How long we keep it",
      blocks: [
        {
          list: [
            ["Unfinished sign-ups: 7 days."],
            [
              "Entries that were not shown in public: 12 months after results, keeping only what a certificate needs.",
            ],
            [
              "Entries shown in public: 5 years after results, and in public only while consent lasts.",
            ],
            [
              "Accounts with no activity: 3 years, with a warning before we delete them.",
            ],
            [
              "Payments, donations and receipts: 8 years from the end of the financial year, as tax law requires.",
            ],
            [
              "Records of consent: 7 years after the data they cover is deleted, as proof.",
            ],
            [
              "Safeguarding records: 7 years after a case closes, or until the child turns 25, whichever is later.",
            ],
            [
              "Certificate records: kept in minimal form, so certificates can always be verified.",
            ],
          ],
        },
      ],
    },
    {
      id: "rights",
      title: "Your rights",
      blocks: [
        {
          p: [
            "You can ask for a summary of the data we hold about you and who we shared it with, ask us to correct, complete, update or delete it, nominate someone to act for you, and complain. A parent or guardian exercises these rights for a child.",
          ],
        },
        {
          p: [
            "Write to our grievance officer (details below). We acknowledge every request within 48 hours and resolve it within 30 days. Every reply names the person you can contact. If you are not satisfied, you can complain to the Data Protection Board of India.",
          ],
        },
      ],
    },
    {
      id: "grievance-officer",
      title: "Grievance officer",
      blocks: [
        {
          list: [
            ["Name: ", { fact: "grievanceOfficerName" }],
            ["Email: ", { fact: "grievanceOfficerEmail" }],
            ["Post: ", { fact: "address" }],
          ],
        },
      ],
    },
    {
      id: "changes",
      title: "Changes to this policy",
      blocks: [
        {
          p: [
            "When we change this policy, we update the date at the top. If a change affects what you agreed to, we ask for your consent again before any new use.",
          ],
        },
      ],
    },
  ],
};
