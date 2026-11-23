import { z } from "zod";

import { SITE_ART_IDS } from "@/lib/art/ids";
import { SITE_IMAGE_IDS } from "@/lib/images/credits";

import { QUOTE_IDS } from "../quotes";

/**
 * The seasonal kindness guide: one entry per month (kid lines scored at
 * Flesch-Kincaid grade ≤ 6). Kid copy never asks a child to touch, feed or
 * follow an animal; it sends them to a grown-up.
 */

/** Sources the monthly entries below cite, by id. */
export const SEASONAL_SOURCES = {
  S04: {
    label: "Delhi High Court, W.P.(C) 13163/2019, 2 Sep 2022",
    url: "https://www.livelaw.in/pdf_upload/vib02092022cw131632019143046-434009.pdf",
  },
  S07: {
    label: "AWBI letter on harmful kite threads, 11 Jan 2026",
    url: "https://awbi.gov.in/uploads/circular/176819679023Manjha.pdf",
  },
  S10: {
    label: "Indian Express, 13 Jan 2026",
    url: "https://indianexpress.com/article/cities/ahmedabad/gujarat-8500-personnel-rescue-thousand-injured-birds-ahead-makara-sankranti-10470685",
  },
  S11: {
    label: "Times of India, “Skies turn deadly in Ahmedabad…”, 13 Jan 2026",
    url: "https://timesofindia.indiatimes.com/city/ahmedabad/skies-turn-deadly-in-ahmedabad-kite-strings-injure-736-birds-in-nine-days/amp_articleshow/126510673.cms",
  },
  S12: {
    label: "PTI/ThePrint, 5 Aug 2025",
    url: "https://theprint.in/india/kite-flying-over-250-birds-injured-in-four-days-vets-and-ngos-report-spike-ahead-of-independence-day/2714336/",
  },
  S13: {
    label: "WHO, Rabies fact sheet",
    url: "https://www.who.int/news-room/fact-sheets/detail/rabies",
  },
  S14: {
    label: "NCDC, National Guidelines for Rabies Prophylaxis, 2019",
    url: "https://ncdc.mohfw.gov.in/uploads/pdf/COH14.pdf",
  },
  S16: {
    label: "PIB, “Steps taken to strengthen rabies treatment”, 19 Aug 2025",
    url: "https://www.pib.gov.in/PressReleasePage.aspx?PRID=2157880",
  },
  S17: {
    label: "Lok Sabha Starred Question 82, 24 Jul 2026",
    url: "https://sansad.in/getFile/lsapps/loksabhaquestions/annex/188/AS82_ifNUiT.pdf?source=lsapps",
  },
  S18: {
    label: "WHO India, “World Rabies Day”",
    url: "https://who.int/india/news-room/detail/12-07-2017-world-rabies-day-2013",
  },
  S19: {
    label: "WHO, World Rabies Day",
    url: "https://www.who.int/campaigns/world-rabies-day",
  },
  S20: {
    label:
      "NCVBDC, Handbook on Prevention and Control of Dengue in School, 2019",
    url: "https://ncvbdc.mohfw.gov.in/Doc/Guidelines/Guidelines-Prevention-Control-of-Dengue-in-School-2019.pdf",
  },
  S21: {
    label: "NDMA, Heat wave do’s and don’ts",
    url: "https://ndma.gov.in/en/heat-wave-dos-donts",
  },
  S22: {
    label: "IMD, FAQ on heat waves",
    url: "https://internal.imd.gov.in/section/nhac/dynamic/FAQ_heat_wave.pdf",
  },
  S23: {
    label:
      "News9live, Tamil Nadu Public Health Department advisory, 5 Feb 2026",
    url: "https://www.news9live.com/state/tamil-nadu/chennai-public-health-dept-issues-advisory-as-crow-deaths-in-city-linked-to-h5n1-bird-flu-virus-2926938",
  },
  S24: {
    label: "AWBI, Holi advisory, 2 Mar 2026",
    url: "https://awbi.gov.in/uploads/circular/177244374751Holi_advisory.pdf",
  },
  S25: {
    label: "AWBI heat advisory, 4 May 2026",
    url: "https://awbi.gov.in/uploads/circular/178038817614177789519989Care%20and%20protection%20of%20animals%20from%20direct%20heat%20during%20extreme%20hot%20(1).pdf",
  },
  S26: {
    label: "AWBI monsoon advisory, 14 Jul 2026",
    url: "https://awbi.gov.in/uploads/circular/178963785700Monsoon%20Advsiory%202026_merged_N.pdf",
  },
  S27: {
    label: "AWBI appeal for winter bedding and cots, 26 Dec 2023",
    url: "https://awbi.gov.in/uploads/regulations/170370610538Appeal%20for%20Welfare%20of%20Animals%20in%20Winter%2026.12.2023.pdf",
  },
  S28: {
    label: "AWBI, World Animal Day advisory, 2026",
    url: "https://awbi.gov.in/uploads/circular/179101213684Observance%20of%20World%20Animal%20Day%20(2).pdf",
  },
  S32: {
    label: "DAHD, cold-wave advisory, 9 Nov 2020",
    url: "https://megahvt.gov.in/notification/Cold%20Wave_advisory.pdf",
  },
  S33: {
    label: "AWBI guidelines on the care of community animals, 2022",
    url: "https://veterinary.assam.gov.in/sites/default/files/swf_utility_folder/departments/ahvetdir_webcomindia_org_oid_4/menu/document/guidelines-of-awbi-for-and-use-of-muzzle-on-dogs-care-of-community-dogs-in-india-.pdf",
  },
  S34: {
    label: "AWBI, list of recognised organisations",
    url: "https://www.awbi.gov.in/view/index/list-of-awo",
  },
  S35: {
    label: "Prevention of Cruelty to Animals Act, 1960",
    url: "https://indiacode.nic.in/bitstream/123456789/11237/1/the_prevention_of_cruelty_to_animals_act,_1960.pdf",
  },
  S44: {
    label:
      "Pal 2003, “Reproductive behaviour of free-ranging rural dogs in West Bengal, India”",
    url: "https://link.springer.com/doi/10.1007/BF03194167",
  },
  S53: {
    label:
      "Humane World for Animals, “How to keep pets warm in cold winter weather”",
    url: "https://www.humaneworld.org/en/resources/how-keep-pets-warm-cold-winter-weather",
  },
  S94: {
    label: "BBC Radio 4, Tweet of the Day: Asian Koel",
    url: "https://www.bbc.co.uk/programmes/b04t0vhm",
  },
  S95: {
    label: "Bird Ecology Study Group, “Food of the Asian Koel”, 22 Oct 2011",
    url: "https://besgroup.org/2011/10/22/food-of-the-asian-koel/",
  },
  S105: {
    label: "WWF-India, “Celebrating Wildlife Week”",
    url: "https://www.wwfindia.org/?12181/WWF-India-Celebrating-Wildlife-Week",
  },
  S107: {
    label: "Great Backyard Bird Count",
    url: "https://www.birdcount.org/",
  },
  S108: { label: "Big Butterfly Month", url: "https://bigbutterflymonth.in/" },
  S109: {
    label: "PIB, “Van Mahotsav: A Commitment to Green India”, 27 Jun 2024",
    url: "https://static.pib.gov.in/WriteReadData/specificdocs/documents/2024/jun/doc2024629345101.pdf",
  },
  S110: {
    label:
      "Times of India, “Traffic curbs on NH-715 to protect Kaziranga wildlife”, 29 Jun 2026",
    url: "https://timesofindia.indiatimes.com/city/guwahati/traffic-curbs-on-nh-715-to-protect-kaziranga-wildlife/articleshow/132074814.cms",
  },
  S113: {
    label: "Humane World for Animals, “How to keep pets safe during Diwali”",
    url: "https://www.humaneworld.org/en/news/tips-keep-pets-safe-during-diwali",
  },
  S115: {
    label: "Times of India, Panchkula cold-wave advisory, 27 Dec 2024",
    url: "https://timesofindia.indiatimes.com/city/chandigarh/stay-indoors-panchkula-dc-issues-cold-wave-advisory/articleshow/116723530.cms",
  },
  S116: {
    label:
      "Tufts Wildlife Clinic, “What to do if you found sick or injured birds”",
    url: "https://vet.tufts.edu/tufts-wildlife-clinic/found-wildlife/what-do-if-you-found-sick-or-injured-other-birds",
  },
  S117: {
    label: "Cornell Lab, All About Birds, “I found a baby bird. What do I do?”",
    url: "https://www.allaboutbirds.org/news/i-found-a-baby-bird-what-do-i-do/",
  },
  S118: {
    label:
      "DD News (IANS), “Over 1.18 lakh injured birds rescued in Gujarat since launch of Karuna Abhiyan”, 2 Feb 2026",
    url: "https://ddnews.gov.in/en/over-1-18-lakh-injured-birds-rescued-in-gujarat-since-launch-of-karuna-abhiyan/",
  },
} as const satisfies Record<string, { label: string; url: string }>;

export type SeasonalSourceId = keyof typeof SEASONAL_SOURCES;

const sourceIds = Object.keys(SEASONAL_SOURCES) as [
  SeasonalSourceId,
  ...SeasonalSourceId[],
];

export const seasonalMonthSchema = z
  .strictObject({
    month: z.int().min(1).max(12),
    slug: z.string().regex(/^[a-z]+$/),
    title: z.string().min(1),
    /** One short line for children (grade ≤ 6). */
    kid: z.string().min(1),
    /** Things a child can do, each one or two short sentences. */
    actions: z.array(z.string().min(1)).min(2).max(4),
    /** "For grown-ups": the practical detail, with the rule or guideline named. */
    grownUps: z.string().min(1),
    /** One true, sourced sentence on why it matters. */
    why: z.string().min(1),
    sources: z.array(z.enum(sourceIds)).min(1),
    imageId: z.enum(SITE_IMAGE_IDS).optional(),
    /**
     * An AI illustration (labelled) for a month with no licensed photo. A photo
     * always wins: a month never has both.
     */
    artId: z.enum(SITE_ART_IDS).optional(),
    quoteId: z.enum(QUOTE_IDS as [string, ...string[]]).optional(),
  })
  .refine((m) => !(m.imageId && m.artId), {
    message: "a month has a photo or an illustration, never both",
    path: ["artId"],
  });

export type SeasonalMonth = z.infer<typeof seasonalMonthSchema>;

export const SEASONAL_MONTHS: readonly SeasonalMonth[] = z
  .array(seasonalMonthSchema)
  .length(12)
  .parse([
    {
      month: 1,
      slug: "january",
      title: "Kite season: plain cotton thread only",
      kid: "Kite string can cut birds. Fly kites only with plain cotton string.",
      actions: [
        "Fly kites only with plain cotton string.",
        "Do not fly kites at sunrise or sunset, when birds are busy flying.",
        "If a bird is stuck in string, do not touch it. Tell a grown-up right away.",
        "On cold mornings, ask a grown-up to knock on the car bonnet before it starts. A cat may be sleeping inside.",
      ],
      grownUps:
        "Use only plain cotton thread, and don’t fly at dawn or dusk. If you find a bird caught in string, cover it gently with a cloth and put it in a ventilated box. Give no food or water, and don’t pull the string out: let a trained rescuer cut it. AWBI’s letter of 11 January 2026 asks every state to “permit only plain cotton thread for kite flying”.",
      why: "In Gujarat’s 2026 Karuna Abhiyan alone (10–20 January), 16,380 birds hurt by kite strings were treated.",
      sources: ["S07", "S10", "S11", "S118", "S53"],
      imageId: "se-kites-uttarayan",
    },
    {
      month: 2,
      slug: "february",
      artId: "season-feb",
      title: "Be a bird counter",
      kid: "Be a bird counter. Scientists use lists like yours.",
      actions: [
        "Sit quietly for 15 minutes. Write down every bird you see or hear.",
        "Ask a grown-up to send your list.",
        "If you see a dead bird, do not touch it. Keep pets away and tell a grown-up.",
      ],
      grownUps:
        "The Great Backyard Bird Count 2027 runs 12–15 February: watch for at least 15 minutes and enter the list on eBird or Merlin. Bird Count India runs a Campus Bird Count for schools and colleges alongside it. Photograph birds, not children. Don’t handle dead birds with bare hands, and report clusters of unexplained bird deaths, especially crows, to the nearest veterinary or animal husbandry office.",
      why: "India’s 2025 count had over 10,000 participants, who recorded 1,086 species: nearly 78% of all bird species found in India.",
      sources: ["S107", "S23"],
    },
    {
      month: 3,
      slug: "march",
      title: "Water bowls: change daily, scrub weekly",
      kid: "Hot days are coming. A bowl of clean water helps birds and animals.",
      actions: [
        "Ask a grown-up for a wide clay bowl. Fill it with clean water and keep it in the shade.",
        "Change the water every day.",
        "Scrub the bowl once a week so mosquitoes cannot grow in it.",
        "Holi colours are for people, not animals. Never put colour on a dog, cat, cow or bird.",
      ],
      grownUps:
        "Use wide, shallow, heavy or earthen bowls that animals cannot tip over, in shade on your own balcony, terrace or garden. Put a stone in the bowl so small birds can perch. Refill with clean water daily, and scrub and dry the bowl at least once a week: Aedes eggs stick just above the waterline and survive drying. At Holi, AWBI asks everyone to “refrain from applying any dry or wet colours on animals, including pets, stray animals, and birds”.",
      why: "Aedes mosquitoes, which spread dengue, can go from egg to adult in about a week in small containers such as bird baths and pets’ water bowls.",
      sources: ["S20", "S25", "S24"],
      imageId: "se-water-junglemyna",
    },
    {
      month: 4,
      slug: "april",
      title: "Shade, water and a noon break",
      kid: "On hot days, dogs pant and look for shade.",
      actions: [
        "Keep a water bowl in a shady spot.",
        "Found a baby bird with feathers on the ground? It is learning to fly. Leave it there and watch from far.",
        "If an animal falls down or cannot get up, tell a grown-up fast.",
      ],
      grownUps:
        "AWBI’s heat advisory asks for shade all day and water in large earthen pots or stable containers. Watch for “excessive panting, lethargy, drooling, rapid heartbeat, and collapse”, and get a vet at once if you see them. A feathered, hopping baby bird is a fledgling: leave it, keep cats and dogs away, and never drip water into its beak. Draught and pack animals may not pull carts or carry loads between 12 noon and 3 pm when it is hotter than 37 °C (rule 6(3), 1965 Rules).",
      why: "AWBI warns that dogs and other animals are especially vulnerable to dehydration, heatstroke and burns from hot surfaces.",
      sources: ["S25", "S117", "S116"],
      imageId: "se-shade-dog-soil",
      quoteId: "Q12",
    },
    {
      month: 5,
      slug: "may",
      artId: "season-may",
      title: "Hot ground, hot cars",
      kid: "Hot roads can burn paws.",
      actions: [
        "Walk pets early in the morning or in the evening.",
        "Never leave a pet in a parked car, not even for a minute.",
        "Hear a loud “ko-EL, ko-EL”? That is a male koel. Listen, then draw the bird you heard.",
      ],
      grownUps:
        "NDMA’s heat-wave advice: “Do not leave children or pets in parked vehicles.” Walk dogs in the early morning or after sunset, and keep water bowls in shade. The koel calls from late March until July. For a school sound map, record sounds only, never children’s voices or faces.",
      why: "IMD says May is the peak heat-wave month in India.",
      sources: ["S21", "S22", "S25", "S94"],
    },
    {
      month: 6,
      slug: "june",
      title: "Rain: knock, look, then drive",
      kid: "When it rains, cats and dogs hide under cars.",
      actions: [
        "Before a car moves, ask a grown-up to knock on the bonnet and look underneath. Every time.",
        "Ask a grown-up if a porch or garage can be a dry spot.",
        "Use a heavy water bowl that will not tip over.",
      ],
      grownUps:
        "In rain and cold, animals shelter under and inside parked vehicles. Before starting, walk round, look under the car, check the wheel arches, bang the bonnet or honk, and wait. AWBI’s monsoon advisory asks for clean water in stable, wide metal bowls, for letting street animals shelter in “porches, garages, or any other covered space”, for local vet contacts lined up in advance, and for waterlogging and blocked drains to be reported to the municipality.",
      why: "AWBI asks that rainy-season shelters be placed “away from pathways, parks, staircases and parking areas where animals are more prone to accidents”.",
      sources: ["S26", "S53"],
      imageId: "se-rain-dog-khar",
    },
    {
      month: 7,
      slug: "july",
      artId: "season-jul",
      title: "Plant a tree for birds",
      kid: "In the first week of July, people across India plant trees.",
      actions: [
        "Ask a grown-up to help you plant a local tree.",
        "Fig trees like the peepal give fruit to koels and many other birds.",
        "In a flood, stay back and let animals pass. Never go into flood water.",
      ],
      grownUps:
        "Van Mahotsav runs 1–7 July, timed to the monsoon, when saplings survive best. Ask the municipal or forest nursery for local native species: figs (banyan, peepal), ber and mulberry are on the koel’s menu. Water and protect the sapling until it is established. In floods, drive slowly, don’t stop to watch or film, and report marooned or injured animals to the forest department or a rescue group.",
      why: "Adult koels eat mostly fruit, including banyan and peepal figs, ber and mulberries.",
      sources: ["S109", "S95", "S110"],
    },
    {
      month: 8,
      slug: "august",
      title: "Kites around Independence Day",
      kid: "Around Independence Day, many kites fly.",
      actions: [
        "Use only plain cotton string.",
        "Bring all your string home.",
        "If a bird is stuck, do not touch it. Tell a grown-up.",
      ],
      grownUps:
        "The January rules hold: plain cotton thread only, and no flying at dawn or dusk. Keep a ventilated box, a towel and a rescue number to hand. Delhi has banned all sharp, synthetic and glass-coated kite thread since 10 January 2017, and Delhi’s fire service attends bird rescues.",
      why: "Vets and NGOs in Delhi report a spike in birds cut by kite string in the days before Independence Day.",
      sources: ["S04", "S12"],
      imageId: "se-kites-uttarayan",
    },
    {
      month: 9,
      slug: "september",
      artId: "season-sep",
      title: "World Rabies Day: what to do if bitten",
      kid: "Never touch a dog, cat or monkey you do not know.",
      actions: [
        "If an animal bites or scratches you, tell a grown-up at once.",
        "Wash the spot with soap and running water for 15 minutes. Then see a doctor the same day.",
        "September is Big Butterfly Month. Count butterflies, draw them, and let them fly free.",
      ],
      grownUps:
        "Wash every bite or scratch at once with soap and plenty of running water for 15 minutes, then see a doctor the same day. Never put chilli, oil, turmeric or lime on it. Anti-rabies vaccine and immunoglobulin are free in public health facilities under the National Free Drug Initiative; local shortages happen, so call the clinic first. Vaccinate pet dogs and cats against rabies every year.",
      why: "World Rabies Day, 28 September, marks the anniversary of the death of Louis Pasteur, who made the first rabies vaccine.",
      sources: ["S19", "S13", "S14", "S16", "S17", "S108"],
    },
    {
      month: 10,
      slug: "october",
      artId: "season-oct",
      title: "Wildlife Week and quieter celebrations",
      kid: "Wildlife Week is 2 to 8 October. 4 October is World Animal Day.",
      actions: [
        "Make a map of the animals near your school.",
        "Draw one animal and write one kind thing you can do for it.",
        "Loud crackers scare animals. Keep your pets inside with you.",
      ],
      grownUps:
        "AWBI asks schools to “promote humane education among students, children and the general public”. Ideas that need no touching or feeding: a neighbour-mapping walk, a 15-minute bird count, a water-bowl rota at the school gate. At Diwali and other cracker celebrations, keep pets indoors with ID tags, leave a porch or garage open for street animals, and keep crackers far from feeding spots and roosting trees. Tying or throwing crackers at an animal is cruelty under section 11(1)(a) of the Prevention of Cruelty to Animals Act.",
      why: "Wildlife Week was conceived by the Indian Board for Wild Life in 1952.",
      sources: ["S28", "S105", "S113", "S35"],
    },
    {
      month: 11,
      slug: "november",
      artId: "season-nov",
      title: "Puppy season: give mothers space",
      kid: "Many puppies are born in winter. Their mother keeps watch.",
      actions: [
        "Do not touch the puppies or go near them.",
        "Wave from far.",
        "Tell a grown-up if one looks hurt.",
      ],
      grownUps:
        "Studies in West Bengal found that street dogs raise pups through winter, with a peak in December. Don’t move or carry off puppies, keep the den area calm, and drive slowly near dens. Ask a recognised animal welfare organisation when the mother and pups can be vaccinated and sterilised under the ABC programme. In the south, the northeast monsoon brings rain from October to December: use the June checklist.",
      why: "In the West Bengal study, mother dogs were “more aggressive immediately following litter production”, so space keeps everyone safe.",
      sources: ["S44", "S34", "S26"],
    },
    {
      month: 12,
      slug: "december",
      title: "Cold nights: warm beds, never fires",
      kid: "Winter nights are cold for street dogs and cats.",
      actions: [
        "Ask a grown-up to put an old blanket or a sack in a dry corner, off the cold floor.",
        "Never light a fire for an animal.",
        "On New Year’s Eve, keep your pets inside with you.",
      ],
      grownUps:
        "Give straw, old blankets, jute sacks or mattresses, raised on a pallet or cot, away from wind, in a dry spot, without blocking public paths. No braziers, heaters or bonfires for animals: burns and smoke harm them, and coal burnt in closed spaces makes carbon monoxide. Don’t burn rubbish, because puppies sleep in rubbish heaps.",
      why: "The government’s cold-wave advisory for animals names newborn, young, sick and weak animals as most at risk.",
      sources: ["S27", "S32", "S33", "S115"],
      imageId: "se-winter-dog-coat-curled",
    },
  ]);

const monthInIndia = new Intl.DateTimeFormat("en-IN", {
  month: "numeric",
  timeZone: "Asia/Kolkata",
});

/** The month (1–12) it is in India at `date`. */
export function seasonalMonthFor(date: Date): number {
  return Number(monthInIndia.format(date));
}

/** This month's guide entry, by the calendar in India. */
export function seasonalGuideFor(date: Date): SeasonalMonth {
  return SEASONAL_MONTHS[seasonalMonthFor(date) - 1]!;
}
