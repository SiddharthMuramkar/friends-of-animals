// The about page as a CMS document (#111), kind `page`. Its fields mirror
// the designed page section by section: headings, leads, the three "how it
// works" steps, the people and objectives lists, and the longer paragraphs
// as rich-text blocks. Photos, quotes, tiles and layout stay in code, so an
// edit changes the words without moving the page's picture or its largest
// text.
//
// Loads under plain Node (seed): relative imports only.

import { z } from "zod";

import { kindOf, plainText, richBlocks } from "./fields";

const heading = () => plainText(120);
const eyebrow = () => plainText(80);
const lead = () => plainText(600);

const titled = z.strictObject({ title: heading(), body: lead() });

const pageBodySchema = z.strictObject({
  hero: z.strictObject({
    eyebrow: eyebrow(),
    title: heading(),
    lead: lead(),
    /** The easy-read line under the lead. */
    easy: plainText(300),
  }),
  duty: z.strictObject({
    eyebrow: eyebrow(),
    title: heading(),
    body: lead(),
    /** Introduces the Supreme Court quote. */
    court: plainText(300),
  }),
  vision: z.strictObject({
    visionTitle: heading(),
    vision: lead(),
    missionTitle: heading(),
    mission: lead(),
  }),
  skill: z.strictObject({
    eyebrow: eyebrow(),
    title: heading(),
    easy: plainText(300),
    body: richBlocks(),
    detailSummary: heading(),
    detail: richBlocks(),
  }),
  ashoka: z.strictObject({
    eyebrow: eyebrow(),
    title: heading(),
    body: lead(),
  }),
  how: z.strictObject({
    eyebrow: eyebrow(),
    title: heading(),
    /** Create, share, grow: each step keeps its icon. */
    steps: z.tuple([titled, titled, titled]),
  }),
  people: z.strictObject({
    eyebrow: eyebrow(),
    title: heading(),
    lead: lead(),
    items: z.array(plainText(80)).min(1).max(16),
  }),
  objectives: z.strictObject({
    eyebrow: eyebrow(),
    title: heading(),
    items: z.array(titled).min(1).max(12),
  }),
  transparency: z.strictObject({
    eyebrow: eyebrow(),
    title: heading(),
    body: lead(),
  }),
  /** The small print under the page: who FOA is not. */
  name: lead(),
});

export type AboutPageBody = z.output<typeof pageBodySchema>;

const paragraph = (text: string) => [{ p: [text] }];

/** Today's about page, as the first published revision. */
const ABOUT_SEED: AboutPageBody = {
  hero: {
    eyebrow: "About us",
    title: "Kindness to animals is something children can learn",
    lead: "Friends of Animals (FOA) is an Indian non-profit. We help children and young adults practise compassion for animals through art, writing, photography and film.",
    easy: "We help children learn to be kind to animals, by making art about them.",
  },
  duty: {
    eyebrow: "Where we start",
    title: "It is in our Constitution",
    body: "Article 51A(g) lists compassion for living creatures among the duties of every Indian citizen. It is a duty and a value, something each of us can practise every day.",
    court: "In 2014 the Supreme Court said what that compassion means:",
  },
  vision: {
    visionTitle: "Our vision",
    vision:
      "To build a world where compassion for animals is a universal human value, inspiring people to treat all animals with respect, kindness, and care.",
    missionTitle: "Our mission",
    mission:
      "To nurture compassion for animals as a lifelong human value, especially among children and young adults, through awareness, education, creative engagement, community participation, and positive action.",
  },
  skill: {
    eyebrow: "Why it works",
    title: "Compassion grows with practice",
    easy: "Kindness gets stronger when you practise it, just like drawing.",
    body: paragraph(
      "To draw a crow well, you have to watch it: how it tilts its head, where it waits, what it needs. Looking that closely turns an animal from background into a neighbour. A competition gives children a reason to look, a deadline to finish, and recognition when they do. We hope the habit lasts long after the certificate is framed."
    ),
    detailSummary: "For parents and teachers",
    detail: paragraph(
      "Indian education policy already asks for this. NEP 2020 names “compassion and empathy” among the aims of education, and the foundational-stage curriculum (NCF-FS 2022) lists kindness to animals as a learning outcome. FOA gives schools a creative way to work on both."
    ),
  },
  ashoka: {
    eyebrow: "An old Indian idea",
    title: "Care for animals, carved in stone",
    body: "In the 3rd century BCE, Emperor Ashoka had his edicts cut into rock across his empire. One of them, at Girnar in Gujarat, records medical care for animals as well as for people.",
  },
  how: {
    eyebrow: "How FOA works",
    title: "From a child’s drawing to a kinder street",
    steps: [
      {
        title: "Children create",
        body: "Drawing, painting, art, craft, essays, photography and films, all about animals and how to treat them well.",
      },
      {
        title: "The public sees",
        body: "Selected work goes into a public gallery and awareness campaigns, with the young artist’s name shown safely.",
      },
      {
        title: "Compassion spreads",
        body: "Families, schools and neighbours meet animals through children’s eyes. More people treat animals with respect, kindness and care.",
      },
    ],
  },
  people: {
    eyebrow: "Who we work with",
    title: "The people who make FOA work",
    lead: "FOA brings together the people who teach children and the people who look after animals.",
    items: [
      "Schools, colleges and universities",
      "Young people who enter on their own",
      "Teachers and school coordinators",
      "Parents and guardians",
      "Judges and jury members",
      "Animal-welfare NGOs and rescuers",
      "Volunteers",
      "Donors and CSR partners",
    ],
  },
  objectives: {
    eyebrow: "Our first six months",
    title: "What we are working on now",
    items: [
      {
        title: "Build and launch the platform",
        body: "One place where young people register, enter competitions, send their work and get their certificates.",
      },
      {
        title: "Run pilot competitions",
        body: "Drawing, painting, art, craft, essay, photography and videography, all about animals and their well-being.",
      },
      {
        title: "Work with schools and colleges",
        body: "Partner with selected institutions to reach children and young adults.",
      },
      {
        title: "Build the first community",
        body: "Help one-time entrants stay connected to animals and to each other.",
      },
      {
        title: "Start an animal-welfare network",
        body: "A structured list of volunteers, welfare organisations and others who help animals.",
      },
      {
        title: "Spread awareness on social media",
        body: "Educational and creative posts, including work by participants.",
      },
      {
        title: "Grow the volunteer network",
        body: "Students and young volunteers in technology, content, outreach and running competitions.",
      },
      {
        title: "Measure and learn",
        body: "Track what works before we grow.",
      },
    ],
  },
  transparency: {
    eyebrow: "Our promise",
    title: "Our accounts will be public",
    body: "FOA has decided to make its financial information public. When donations begin, we will publish what came in and where it went, so anyone can check.",
  },
  name: "Friends of Animals (FOA) is an Indian non-profit. We are not connected with other organisations that use the same name, in India or abroad.",
};

export const pageKind = kindOf(pageBodySchema, ABOUT_SEED);
