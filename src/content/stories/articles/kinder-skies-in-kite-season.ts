import type { ArticleBody } from "../model";

// Brief: research/stories.md §4 D; dossier S7. DIRECTION §5: "Fly kites only
// with plain cotton thread"; children never handle a hurt bird. Helpline
// numbers are dated to January 2026: recheck every December.
export const article = {
  blocks: [
    {
      type: "paragraph",
      text: [
        "For ten days every January, Gujarat runs a bird rescue on the scale of a festival. In 2026, more than 728 vets and over 8,620 volunteers worked at more than 1,036 treatment and collection centres, ready for birds hurt by kite string.",
        { fn: "f1" },
        " The kites still fly. The people on the ground keep an eye on the sky’s other residents.",
      ],
    },
    { type: "heading", level: 2, text: "Kites up, birds out" },
    {
      type: "paragraph",
      text: [
        "In Gujarat, the big kite days come in mid-January, around Makar Sankranti.",
        { fn: "f3" },
        " In Delhi, the sky fills with kites around Independence Day in August.",
        { fn: "f9" },
        " Kite string is hard for a flying bird to see. Strong string, especially nylon or string coated with glass, can wound a bird that flies into it.",
        { fn: "f10" },
      ],
    },
    {
      type: "paragraph",
      text: [
        "None of this means the festival has to stop. It means a few habits, and knowing who to call.",
      ],
    },
    { type: "heading", level: 2, text: "Ten days of care in Gujarat" },
    {
      type: "paragraph",
      text: [
        "Since 2017, Gujarat has run Karuna Abhiyan, a “compassion campaign”, from 10 to 20 January. The state’s animal husbandry and forest departments run it with city corporations and volunteer groups.",
        { fn: "f1" },
      ],
    },
    {
      type: "paragraph",
      text: [
        "According to the state, 16,380 birds hurt by kite string were treated across Gujarat during the 2026 campaign, and 14,690 of them survived. They belonged to 41 different species.",
        { fn: "f2" },
      ],
    },
    {
      type: "paragraph",
      text: [
        "Volunteers were doing this work before the state campaign began. Around Uttarayan in 2014, one Ahmedabad group, the Jivdaya Charitable Trust, looked after 2,394 injured birds.",
        { fn: "f10" },
      ],
    },
    {
      type: "heading",
      level: 2,
      text: "A hospital for birds in Chandni Chowk",
    },
    {
      type: "paragraph",
      text: [
        "In Old Delhi, inside the Digambar Jain Lal Mandir complex, the Charity Birds Hospital has cared for birds since about 1929. Anyone can bring a bird in, and the care is free.",
        { fn: "f6" },
      ],
    },
    {
      type: "paragraph",
      text: [
        "Most of its patients are pigeons, but parrots, kites, vultures and peacocks come in too, depending on the season.",
        { fn: "f6" },
        " When a bird is well again, the hospital does not hand it back to whoever brought it. It sets it free.",
        { fn: "f8" },
      ],
    },
    {
      type: "sourceQuote",
      text: "We release all the birds we heal, even those that have been illegally kept as pets",
      attribution: "Charity Birds Hospital, to Mint, 2026",
      fn: "f7",
    },
    { type: "heading", level: 2, text: "Thread, timing and a quick call" },
    {
      type: "list",
      style: "bullet",
      items: [
        [
          { strong: "Thread." },
          " Fly kites only with plain cotton thread. In 2017 the National Green Tribunal directed every state to stop the making, sale and use of nylon and synthetic kite string.",
          { fn: "f5" },
        ],
        [
          { strong: "Timing." },
          " Birds are busiest at sunrise and sunset. In January 2026 Gujarat again asked people not to fly kites at those hours.",
          { fn: "f3" },
          " Back in 2010, the state advised against 6 to 8 am and 5 to 7 pm.",
          { fn: "f4" },
        ],
        [
          { strong: "A quick call." },
          " Save the numbers before the festival. During Karuna Abhiyan 2026, people in Gujarat could send “Hi” on WhatsApp to 8320002000 for a list of nearby centres, or call the forest helpline 1926 or the animal helpline 1962.",
          { fn: "f1" },
          { fn: "f3" },
          " Numbers change, so check them each January. Elsewhere, save your local animal rescue’s number before you need it.",
        ],
        [
          { strong: "At home." },
          " If birds fly into your rooms, a wire-mesh cover on the ceiling fan keeps them away from the blades, a tip from the Delhi hospital’s manager.",
          { fn: "f8" },
        ],
      ],
    },
    { type: "heading", level: 2, text: "If you find a hurt bird" },
    {
      type: "paragraph",
      text: ["Children should not touch a hurt bird. Tell a grown-up."],
    },
    {
      type: "paragraph",
      text: [
        "Grown-ups: a Delhi vet’s advice is not to pull out string from a wound that has clotted, because that can start the bleeding again, and not to put turmeric, iodine or ointment on it. Wrap the bird loosely in a cloth and take it to a vet or a local animal welfare group.",
        { fn: "f9" },
      ],
    },
    {
      type: "callout",
      tone: "info",
      title: "Kite-day rules for children",
      body: [
        ["Fly kites only with plain cotton thread."],
        [
          "Start after breakfast. Stop before sunset. Birds fly most at dawn and dusk.",
        ],
        [
          "If a bird is stuck in string, do not pull it or touch it. Tell a grown-up.",
        ],
      ],
    },
    {
      type: "callout",
      tone: "success",
      title: "What you can do this week",
      body: [
        [
          "Check your kite string. If it isn’t plain cotton, swap it before the next kite day.",
        ],
        [
          "Leave the sky to the birds at dawn and dusk: start after breakfast, and stop before sunset.",
        ],
        [
          "Save the help numbers in a family phone before the festival. If a bird is caught in thread, don’t pull it; tell a grown-up, who can wrap it loosely in a cloth and take it to the nearest treatment centre.",
        ],
      ],
    },
  ],
  footnotes: [
    {
      id: "f1",
      text: "Chief Minister’s Office, Gujarat, “Karuna Abhiyan 2026”, 13 Jan 2026",
      url: "https://cmogujarat.gov.in/en/latest-news/karuna-abhiyan-2026-gujarat-cm-visit-wildlife-care-centre",
    },
    {
      id: "f2",
      text: "DD News (IANS), “Over 1.18 lakh injured birds rescued in Gujarat since launch of Karuna Abhiyan”, 2 Feb 2026",
      url: "https://ddnews.gov.in/en/over-1-18-lakh-injured-birds-rescued-in-gujarat-since-launch-of-karuna-abhiyan",
    },
    {
      id: "f3",
      text: "The Indian Express, “Gujarat: 8,500 personnel to rescue injured birds ahead of Makara Sankranti”, 13 Jan 2026",
      url: "https://indianexpress.com/article/cities/ahmedabad/gujarat-8500-personnel-rescue-thousand-injured-birds-ahead-makara-sankranti-10470685",
    },
    {
      id: "f4",
      text: "The Times of India, “Save birds, don’t fly kites in morning and evening: govt”, 3 Dec 2010",
      url: "https://timesofindia.indiatimes.com/city/ahmedabad/save-birds-dont-fly-kites-in-morning-and-evening-govt/articleshow/7039625.cms",
    },
    {
      id: "f5",
      text: "The Economic Times, “NGT bans nylon, synthetic manja”, 11 Jul 2017",
      url: "http://economictimes.com/news/environment/the-good-earth/ngt-bans-nylon-synthetic-manja/articleshow/59545891.cms",
    },
    {
      id: "f6",
      text: "BirdNote, “Delhi’s Jain bird hospital”, 2023 (reissued 4 Aug 2025)",
      url: "https://www.birdnote.org/podcasts/birdnote-daily/delhis-jain-bird-hospital-free",
    },
    {
      id: "f7",
      text: "Mint, on the Charity Birds Hospital, 19 Jul 2026",
      url: "https://www.livemint.com/mint-lounge/ideas/bird-charity-hospital-delhi-ncr-11784286038552.html",
    },
    {
      id: "f8",
      text: "AFP via ThingsAsian, report on the Charity Birds Hospital, 16 Apr 2003",
      url: "https://www.thingsasian.com/node/1256.html",
    },
    {
      id: "f9",
      text: "The Pioneer, “For once, listen to all creatures great and small”, 16 Aug 2024",
      url: "https://dailypioneer.com/pioneer-exclusive/for-once--listen-to-all-creatures-great-and-small",
    },
    {
      id: "f10",
      text: "The Guardian, on bird injuries at Uttarayan, 14 Jan 2015",
      url: "https://theguardian.com/environment/2015/jan/14/uttarayan-bird-fatalities-kite-festival-india-makar-sankranti-january-14",
    },
  ],
} satisfies ArticleBody;
