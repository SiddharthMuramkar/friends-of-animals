import { z } from "zod";

/**
 * The verified quote bank (research/quotes.md §3, §5): every quote in the
 * placement map plus the strong alternates. `text` is the source wording,
 * copied exactly (spelling, punctuation and archaic words untouched). A
 * `display` excerpt may only trim with "…"; the tests check that each piece
 * still appears in `text`. One quote per surface; see `placements`.
 */

const quoteSchema = z
  .strictObject({
    id: z.string().regex(/^Q\d{2}[a-z]?$/),
    text: z.string().min(1),
    /** Shorter form for display; pieces between "…" must appear in text. */
    display: z.string().min(1).optional(),
    /** BCP 47 language of the text. */
    lang: z.enum(["en", "hi"]),
    /** Original-language text, shown in its script with `lang` set. */
    original: z
      .strictObject({ text: z.string(), lang: z.enum(["ta"]) })
      .optional(),
    author: z.string().min(1),
    work: z.string().min(1),
    /** Book, poem or case titles are italic; laws, speeches and edicts are not. */
    workIsTitle: z.boolean(),
    year: z.string().optional(),
    /** Paragraph, section, verse, chapter or page. */
    locator: z.string().optional(),
    translator: z.string().optional(),
    /** Primary source (or the best reliable source) the wording was checked against. */
    sourceUrl: z.url().optional(),
    /** Printed citation, for in-copyright books with no lawful online copy. */
    citation: z.string().optional(),
    verdict: z.enum(["VERIFIED", "ATTRIBUTED-RELIABLE"]),
    /** "short-quote": in copyright or under licence; short quotation with credit only. */
    rights: z.enum(["free", "short-quote"]),
    /** FOA's own plain-words line for kid pages, never inside quote marks. */
    kidGloss: z.string().optional(),
    placements: z.array(z.string()).min(1),
  })
  .refine((q) => q.sourceUrl ?? q.citation, {
    message: "a quote needs a source URL or a printed citation",
  });

export type Quote = z.infer<typeof quoteSchema>;

const STRAY_BIRDS = "https://en.wikisource.org/wiki/Stray_Birds";
const KURAL_PM = "https://projectmadurai.org/pm_etexts/utf8/pmuni0153.html";
const KURAL_1886 =
  "https://ia800808.us.archive.org/8/items/tiruvalluvanayan00tiruuoft/tiruvalluvanayan00tiruuoft.pdf";
const DHAMMIKA =
  "https://www.accesstoinsight.org/lib/authors/dhammika/wheel386.html";
const DARWIN_1871 =
  "https://darwin-online.org.uk/content/contentblock?basepage=1&itemID=F937.1&hitpage=427&viewtype=side";
const NEHRU_1954 =
  "https://nehruarchive.in/documents/prevention-of-cruelty-to-animals-5-march-1954-v8ojg";
const NEHRU_TEXT =
  "I entirely agree with the honourable Mover that one test of civilisation, a very major test, is the growth of this feeling and practice of compassion. All the great men have said so and said so rightly, if I may say that with all humility, but compassion has to be effective compassion and not merely some kind of, if I may say so, flabby feeling which really creates more misery instead of removing misery.";

const tagore = (no: number, text: string, placements: string[]) =>
  ({
    id: "",
    text,
    lang: "en",
    author: "Rabindranath Tagore",
    work: "Stray Birds",
    workIsTitle: true,
    year: "1916",
    locator: `no. ${no}`,
    sourceUrl: STRAY_BIRDS,
    verdict: "VERIFIED",
    rights: "free",
    placements,
  }) as const;

const pope = (no: number, text: string, placements: string[]) =>
  ({
    id: "",
    text,
    lang: "en",
    author: "Thiruvalluvar",
    work: "Thirukkural",
    workIsTitle: true,
    locator: `kural ${no}`,
    translator: "G.U. Pope (1886)",
    sourceUrl: KURAL_PM,
    verdict: "VERIFIED",
    rights: "free",
    placements,
  }) as const;

const RAW = {
  Q01: {
    text: "51A. Fundamental duties.—It shall be the duty of every citizen of India— … (g) to protect and improve the natural environment including forests, lakes, rivers and wild life, and to have compassion for living creatures;",
    display: "…to have compassion for living creatures",
    lang: "en",
    author: "Constitution of India",
    work: "Article 51A(g)",
    workIsTitle: false,
    sourceUrl:
      "https://www.legislative.gov.in/static/uploads/2025/08/b9a933fb88c0a5afba254256bc55a3f0.pdf",
    verdict: "VERIFIED",
    rights: "free",
    placements: ["About: why compassion", "Kindness pledge card"],
  },
  Q02: {
    // Reconstructed from a lossy PDF extraction: proofread against the
    // printed page before hi-IN ships (quotes.md Q02).
    text: "(छ) प्राकृतिक पर्यावरण की, जिसके अंतर्गत वन, झील, नदी और वन्य जीव हैं, रक्षा करे और उसका संवर्धन करे तथा प्राणि मात्र के प्रति दयाभाव रखे;",
    display: "…प्राणि मात्र के प्रति दयाभाव रखे",
    lang: "hi",
    author: "भारत का संविधान",
    work: "अनुच्छेद 51क(छ)",
    workIsTitle: false,
    sourceUrl:
      "https://www.legislative.gov.in/static/uploads/2025/08/cb1b190ea633a1746368ed1fac35fb30.pdf",
    verdict: "VERIFIED",
    rights: "free",
    placements: ["hi-IN About", "hi-IN pledge card"],
  },
  Q03: {
    text: "Article 51A(g), therefore, enjoins that it was a fundamental duty of every citizen “to have compassion for living creatures”, which means concern for suffering, sympathy, kindliness etc., which has to be read along with Sections 3, 11(1)(a) & (m), 22 etc. of PCA Act.",
    display:
      "“to have compassion for living creatures”, which means concern for suffering, sympathy, kindliness etc.",
    lang: "en",
    author: "Supreme Court of India",
    work: "AWBI v. A. Nagaraja",
    workIsTitle: true,
    year: "2014",
    locator: "para 57",
    sourceUrl: "https://indiankanoon.org/doc/39696860/",
    verdict: "VERIFIED",
    rights: "free",
    placements: [
      "About, under Q01 (quote the definition only; never name the case's subject)",
    ],
  },
  Q04: {
    text: "It shall be the duty of every person having the care or charge of any animal to take all reasonable measures to ensure the well-being of such animal and to prevent the infliction upon such animal of unnecessary pain or suffering.",
    lang: "en",
    author: "Prevention of Cruelty to Animals Act",
    work: "1960",
    workIsTitle: false,
    locator: "section 3",
    sourceUrl:
      "https://www.indiacode.nic.in/show-data?actid=AC_CEN_16_18_00001_196059_1517807317734&orderno=3&sectionId=4023&sectionno=3",
    verdict: "VERIFIED",
    rights: "free",
    placements: ["Awareness: what the law says"],
  },
  Q06: {
    text: "Therefore, I am clear in mind that all the birds have fundamental rights to fly in the sky and all human beings have no right to keep them in small cages for the purposes of their business or otherwise.",
    lang: "en",
    author: "Delhi High Court",
    work: "People for Animals v. Md Mohazzim",
    workIsTitle: true,
    year: "2015",
    locator: "order of 15 May 2015",
    sourceUrl:
      "https://awbi.gov.in/uploads/courtorder/168915234815CRL.%20MC%202051%20of%202015%20birds%20fundamental%20right%20to%20fly%20order%20DHC.pdf",
    verdict: "VERIFIED",
    rights: "free",
    placements: [
      "Street-neighbour bird card, framed as history (an interim order, not settled law)",
    ],
  },
  Q07: {
    text: "The purpose of the education system is to develop good human beings capable of rational thought and action, possessing compassion and empathy, courage and resilience, scientific temper and creative imagination, with sound ethical moorings and values.",
    lang: "en",
    author: "Ministry of Education",
    work: "National Education Policy 2020",
    workIsTitle: true,
    locator: "Principles of this Policy",
    sourceUrl:
      "https://www.ncf.ncert.gov.in/assets/uploadedfiles/documents/NEP_Final_English_0.pdf",
    verdict: "VERIFIED",
    rights: "free",
    placements: [
      "Schools: already in your curriculum (as a reference, not a hero quote)",
    ],
  },
  Q08: {
    text: "Shows kindness and helpfulness to others (including animals, plants) when they are in need",
    lang: "en",
    author: "NCERT",
    work: "National Curriculum Framework for Foundational Stage",
    workIsTitle: true,
    year: "2022",
    locator: "C-4.6",
    sourceUrl:
      "https://ncert.nic.in/pdf/NCF_for_Foundational_Stage_20_October_2022.pdf",
    verdict: "VERIFIED",
    rights: "free",
    placements: ["Schools: already in your curriculum"],
  },
  Q08b: {
    text: "Shows care for and joy in engaging with all life forms",
    lang: "en",
    author: "NCERT",
    work: "National Curriculum Framework for Foundational Stage",
    workIsTitle: true,
    year: "2022",
    locator: "C-6.1",
    sourceUrl:
      "https://ncert.nic.in/pdf/NCF_for_Foundational_Stage_20_October_2022.pdf",
    verdict: "VERIFIED",
    rights: "free",
    placements: ["Schools: already in your curriculum"],
  },
  Q09: {
    text: "The Report (1999) of the Committee chaired by me to suggest the methods to operationalise the fundamental duties, has recommended inclusion thereof in the curriculum of studies commencing at the primary level and extending upwards even to the professionals.",
    lang: "en",
    author: "Justice J.S. Verma",
    work: "lecture published by the University Grants Commission",
    workIsTitle: false,
    sourceUrl: "https://www.ugc.gov.in/oldpdf/pub/lectures/ugc_js_v.pdf",
    verdict: "VERIFIED",
    rights: "free",
    placements: ["Schools: why through schools"],
  },
  Q10a: {
    text: NEHRU_TEXT,
    display:
      "…one test of civilisation, a very major test, is the growth of this feeling and practice of compassion.",
    lang: "en",
    author: "Jawaharlal Nehru",
    work: "speech in the Rajya Sabha",
    workIsTitle: false,
    locator: "5 March 1954",
    sourceUrl: NEHRU_1954,
    verdict: "VERIFIED",
    rights: "free",
    placements: ["Stories: Rukmini Devi Arundale feature"],
  },
  Q10b: {
    text: NEHRU_TEXT,
    display: "…compassion has to be effective compassion…",
    lang: "en",
    author: "Jawaharlal Nehru",
    work: "speech in the Rajya Sabha",
    workIsTitle: false,
    locator: "5 March 1954",
    sourceUrl: NEHRU_1954,
    verdict: "VERIFIED",
    rights: "free",
    placements: ["Impact"],
  },
  Q11: {
    text: "…two types of medical treatment: medical treatment for humans and medical treatment for animals. Wherever medical herbs suitable for humans or animals are not available, I have had them imported and grown. Wherever medical roots or fruits are not available I have had them imported and grown. Along roads I have had wells dug and trees planted for the benefit of humans and animals.",
    display:
      "…two types of medical treatment: medical treatment for humans and medical treatment for animals…",
    lang: "en",
    author: "Ashoka",
    work: "Rock Edict II",
    workIsTitle: false,
    year: "3rd century BCE",
    translator: "Ven. S. Dhammika (1993)",
    sourceUrl: DHAMMIKA,
    verdict: "VERIFIED",
    rights: "short-quote",
    placements: [
      "About: heritage strip (say “medical treatment”, never “hospitals”)",
    ],
  },
  Q12: {
    text: "Along roads I have had banyan trees planted so that they can give shade to animals and men, and I have had mango groves planted. At intervals of eight krosas, I have had wells dug, rest-houses built, and in various places, I have had watering-places made for the use of animals and men. But these are but minor achievements. Such things to make the people happy have been done by former kings.",
    display:
      "Along roads I have had banyan trees planted so that they can give shade to animals and men, and I have had mango groves planted. At intervals of eight krosas, I have had wells dug, rest-houses built, and in various places, I have had watering-places made for the use of animals and men.",
    lang: "en",
    author: "Ashoka",
    work: "Pillar Edict VII",
    workIsTitle: false,
    year: "242 BCE",
    translator: "Ven. S. Dhammika (1993)",
    sourceUrl: DHAMMIKA,
    verdict: "VERIFIED",
    rights: "short-quote",
    placements: ["Seasonal guide: summer water and shade"],
  },
  Q13: {
    text: "Beloved-of-the-Gods, King Piyadasi, speaks thus: Dhamma is good, but what constitutes Dhamma? (It includes) little evil, much good, kindness, generosity, truthfulness and purity. I have given the gift of sight in various ways. To two-footed and four-footed beings, to birds and aquatic animals, I have given various things including the gift of life.",
    display:
      "To two-footed and four-footed beings, to birds and aquatic animals, I have given various things including the gift of life.",
    lang: "en",
    author: "Ashoka",
    work: "Pillar Edict II",
    workIsTitle: false,
    year: "3rd century BCE",
    translator: "Ven. S. Dhammika (1993)",
    sourceUrl: DHAMMIKA,
    verdict: "VERIFIED",
    rights: "short-quote",
    placements: ["Street neighbours: intro"],
  },
  Q15: {
    ...pope(
      250,
      "When weaker men you front with threat'ning brow, / Think how you felt in presence of some stronger foe.",
      ["Kindness pledge card"]
    ),
    original: {
      text: "வலியார்முன் தன்னை நினைக்கதான் தன்னின் / மெலியார்மேல் செல்லு மிடத்து.",
      lang: "ta",
    },
    sourceUrl: KURAL_1886,
    kidGloss:
      "Before you shoo an animal, remember a time someone bigger scared you.",
  },
  Q15b: {
    ...pope(
      250,
      "When a man is about to rush upon those who are weaker than himself, let him remember how he has stood (trembling) before those who are stronger than himself.",
      ["Kindness pledge card (prose, for kid pages)"]
    ),
    translator: "W.H. Drew and John Lazarus",
    kidGloss:
      "Before you shoo an animal, remember a time someone bigger scared you.",
  },
  Q16: pope(
    322,
    "Let those that need partake your meal; guard every-thing that lives; / This the chief and sum of lore that hoarded wisdom gives.",
    ["Awareness: sharing-food card, beside lawful feeding guidance"]
  ),
  Q17: pope(
    211,
    "Duty demands no recompense; to clouds of heaven, / By men on earth, what answering gift is given?",
    ["Donate (alternate to Q24)"]
  ),
  Q18: pope(
    215,
    "The wealth of men who love the 'fitting way,' the truly wise, / Is as when water fills the lake that village needs supplies.",
    ["Transparency (when built)"]
  ),
  Q19: pope(
    118,
    "To stand, like balance-rod that level hangs and rightly weighs, / With calm unbiassed equity of soul, is sages' praise.",
    ["Competition detail: how judging works"]
  ),
  Q21: {
    text: "O King, this deer belongs to the hermitage. / Why should his tender form expire, / As blossoms perish in the fire? / How could that gentle life endure / The deadly arrow, sharp and sure? / Restore your arrow to the quiver; / To you were weapons lent / The broken-hearted to deliver, / Not strike the innocent.",
    display:
      "To you were weapons lent / The broken-hearted to deliver, / Not strike the innocent.",
    lang: "en",
    author: "Kalidasa",
    work: "Shakuntala",
    workIsTitle: true,
    locator: "Act I",
    translator: "Arthur W. Ryder (1912)",
    sourceUrl: "https://www.gutenberg.org/ebooks/16659",
    verdict: "VERIFIED",
    rights: "free",
    kidGloss: "A king lowered his bow.",
    placements: ["Awareness: courage to care"],
  },
  Q22: tagore(
    123,
    "The bird thinks it is an act of kindness to give the fish a lift in the air.",
    ["Awareness: kindness that helps"]
  ),
  Q23: tagore(
    83,
    "He who wants to do good knocks at the gate; he who loves finds the gate open.",
    ["Join / community (later)"]
  ),
  Q24: tagore(
    159,
    "When we rejoice in our fulness, then we can part with our fruits with joy.",
    ["Donate"]
  ),
  Q25: tagore(
    113,
    "The hills are like shouts of children who raise their arms, trying to catch stars.",
    ["Competitions: list hero", "Home: gallery frames (alternate)"]
  ),
  Q26: tagore(
    35,
    "The bird wishes it were a cloud. The cloud wishes it were a bird.",
    ["404 with the doodle pad"]
  ),
  Q27: tagore(
    58,
    "The sparrow is sorry for the peacock at the burden of its tail.",
    ["Street-neighbour sparrow card"]
  ),
  Q29: {
    text: "The highest education is that which does not merely give us information but makes our life in harmony with all existence. But we find that this education of sympathy is not only systematically ignored in schools, but it is severely repressed.",
    display:
      "The highest education is that which does not merely give us information but makes our life in harmony with all existence.",
    lang: "en",
    author: "Rabindranath Tagore",
    work: "Personality",
    workIsTitle: true,
    year: "1917",
    locator: "“My School”",
    sourceUrl:
      "https://en.wikisource.org/wiki/Personality_(Lectures_delivered_in_America)/My_School",
    verdict: "VERIFIED",
    rights: "free",
    placements: ["Schools: hero"],
  },
  Q32a: {
    text: "And having been blessed with children, I discovered that the law of Love could be best understood and learned through little children.",
    lang: "en",
    author: "Mahatma Gandhi",
    work: "speech at the Montessori Training College, London",
    workIsTitle: false,
    locator: "28 October 1931",
    sourceUrl: "https://www.mkgandhi.org/momgandhi/chap58.php",
    verdict: "VERIFIED",
    rights: "free",
    placements: ["Home: why children"],
  },
  Q33: {
    text: "I have watched birds through half a century and more, chiefly for the pleasure and elation of the spirit they have afforded.",
    lang: "en",
    author: "Salim Ali",
    work: "The Fall of a Sparrow",
    workIsTitle: true,
    year: "1985",
    locator: "p. 227",
    sourceUrl:
      "https://scroll.in/article/1088137/the-unexpected-beginnings-of-salim-alis-lifelong-scientific-pursuits",
    verdict: "ATTRIBUTED-RELIABLE",
    rights: "short-quote",
    placements: ["Stories: profile", "Street-neighbour bird cards"],
  },
  Q34: {
    text: "Wherever I have lived, be it city or small town or hill station, I have always managed to find some corner where birds sing, or flowers grow, or small creatures survive. … Live close to nature and you will never feel lonely. Don't drive those sparrows out of your veranda; they won't hack into your computer.",
    display:
      "Don't drive those sparrows out of your veranda; they won't hack into your computer.",
    lang: "en",
    author: "Ruskin Bond",
    work: "Ruskin Bond's Book of Nature",
    workIsTitle: true,
    year: "2004",
    locator: "“The Civilized Wilderness”",
    citation:
      "Ruskin Bond, Ruskin Bond's Book of Nature (Viking/Penguin India, 2004), II “The Civilized Wilderness”, p. 29",
    verdict: "VERIFIED",
    rights: "short-quote",
    placements: [
      "Street-neighbour sparrow card (ask Penguin before a centrepiece use)",
    ],
  },
  Q36: {
    text: "…the lower animals, like man, manifestly feel pleasure and pain, happiness and misery. Happiness is never better exhibited than by young animals, such as puppies, kittens, lambs, &c., when playing together, like our own children.",
    display:
      "Happiness is never better exhibited than by young animals, such as puppies, kittens, lambs, &c., when playing together, like our own children.",
    lang: "en",
    author: "Charles Darwin",
    work: "The Descent of Man",
    workIsTitle: true,
    year: "1871",
    locator: "vol. I, ch. II, p. 39",
    sourceUrl: DARWIN_1871,
    verdict: "VERIFIED",
    rights: "free",
    placements: ["Home: joy band"],
  },
  Q37: {
    text: "Sympathy beyond the confines of man, that is humanity to the lower animals, seems to be one of the latest moral acquisitions. … This virtue, one of the noblest with which man is endowed, seems to arise incidentally from our sympathies becoming more tender and more widely diffused, until they are extended to all sentient beings. As soon as this virtue is honoured and practised by some few men, it spreads through instruction and example to the young, and eventually through public opinion.",
    display:
      "As soon as this virtue is honoured and practised by some few men, it spreads through instruction and example to the young, and eventually through public opinion.",
    lang: "en",
    author: "Charles Darwin",
    work: "The Descent of Man",
    workIsTitle: true,
    year: "1871",
    locator: "vol. I, ch. III, pp. 100–101",
    sourceUrl: DARWIN_1871,
    verdict: "VERIFIED",
    rights: "free",
    placements: ["Schools: why start with children (alternate)"],
  },
  Q39: {
    text: "If a child is to keep alive his inborn sense of wonder without any such gift from the fairies, he needs the companionship of at least one adult who can share it, rediscovering with him the joy, excitement and mystery of the world we live in.",
    lang: "en",
    author: "Rachel Carson",
    work: "“Help Your Child to Wonder”, Woman's Home Companion",
    workIsTitle: false,
    year: "1956",
    sourceUrl: "https://rachelcarsoncouncil.org/help-child-wonder",
    verdict: "VERIFIED",
    rights: "free",
    placements: ["Competitions: taking part on your own"],
  },
  Q40: {
    text: "we call them dumb animals, and so they are, for they cannot tell us how they feel, but they do not suffer less because they have no words",
    lang: "en",
    author: "Anna Sewell",
    work: "Black Beauty",
    workIsTitle: true,
    year: "1877",
    locator: "ch. 46",
    sourceUrl:
      "https://en.wikisource.org/wiki/Page:Black_Beauty_(1877).djvu/235",
    verdict: "VERIFIED",
    rights: "free",
    kidGloss: "Here “dumb” means “unable to speak”.",
    placements: ["Awareness: animals feel"],
  },
  Q40b: {
    text: "Is it not better to lead a good fashion, than to follow a bad one?",
    lang: "en",
    author: "Anna Sewell",
    work: "Black Beauty",
    workIsTitle: true,
    year: "1877",
    locator: "ch. 46",
    sourceUrl:
      "https://en.wikisource.org/wiki/Page:Black_Beauty_(1877).djvu/235",
    verdict: "VERIFIED",
    rights: "free",
    placements: ["Join / school clubs (later)"],
  },
  Q41: {
    text: "My doctrine is this, that if we see cruelty or wrong that we have the power to stop, and do nothing, we make ourselves sharers in the guilt.",
    lang: "en",
    author: "Anna Sewell",
    work: "Black Beauty",
    workIsTitle: true,
    year: "1877",
    locator: "ch. 38",
    sourceUrl: "https://www.gutenberg.org/ebooks/271",
    verdict: "VERIFIED",
    rights: "free",
    placements: [
      "Awareness: if you see cruelty, beside the helplines (never on Donate)",
    ],
  },
  Q42: {
    text: "Only if we understand, can we care. Only if we care, will we help. Only if we help, shall all be saved.",
    lang: "en",
    author: "Jane Goodall",
    work: "Jane Goodall: 40 Years at Gombe",
    workIsTitle: true,
    year: "1999",
    locator: "p. 5",
    sourceUrl:
      "https://d3kr0g7umcubly.cloudfront.net/candlewick-press-us/pdfs/chapter-sample/9781536227680-sample-1.pdf",
    verdict: "ATTRIBUTED-RELIABLE",
    rights: "short-quote",
    placements: ["Awareness: intro"],
  },
  Q43: {
    text: "Roots creep underground everywhere and make a firm foundation. Shoots seem very weak, but to reach the light, they can break open brick walls. Imagine that the brick walls are all the problems we have inflicted on our planet. Hundreds of thousands of roots and shoots, hundreds of thousands of young people around the world, can break through these walls.",
    lang: "en",
    author: "Jane Goodall",
    work: "on the name Roots & Shoots",
    workIsTitle: false,
    sourceUrl:
      "https://amnh.org/learn-teach/curriculum-collections/biodiversity-crisis/profile-jane-goodall",
    verdict: "ATTRIBUTED-RELIABLE",
    rights: "short-quote",
    placements: [
      "Badges explainer (no implied affiliation with Roots & Shoots)",
    ],
  },
  Q44: {
    text: "In the end we will conserve only what we love; we will love only what we understand; and we will understand only what we are taught.",
    lang: "en",
    author: "Baba Dioum",
    work: "IUCN General Assembly, New Delhi",
    workIsTitle: false,
    year: "1968",
    sourceUrl: "https://en.wikipedia.org/wiki/Baba_Dioum",
    verdict: "ATTRIBUTED-RELIABLE",
    rights: "free",
    placements: ["Schools (alternate)", "Awareness: intro (alternate)"],
  },
} as const;

export type QuoteId = keyof typeof RAW;

export const QUOTES: readonly Quote[] = z
  .array(quoteSchema)
  .parse(Object.entries(RAW).map(([id, q]) => ({ ...q, id })));

export const QUOTE_IDS = Object.keys(RAW) as QuoteId[];

const byId = new Map(QUOTES.map((q) => [q.id, q]));

export function quote(id: QuoteId): Quote {
  return byId.get(id)!;
}

/** "Rabindranath Tagore, Stray Birds (1916), no. 123" (quotes.md §0 rule 3). */
export function attribution(q: Quote): string {
  const work = q.year ? `${q.work} (${q.year})` : q.work;
  const parts = [q.author, work, q.locator].filter(Boolean).join(", ");
  return q.translator ? `${parts}, translated by ${q.translator}` : parts;
}
