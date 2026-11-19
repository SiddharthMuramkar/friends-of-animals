import { z } from "zod";

import { SITE_IMAGE_IDS } from "@/lib/images/credits";

import { QUOTE_IDS } from "../quotes";

/**
 * Street-neighbour cards, from research/seasonal-neighbours.md §B. Front: one
 * verified fact a child can enjoy. Back: how to be a good neighbour. Kid lines
 * never ask a child to touch, feed or follow an animal (DIRECTION §5); the
 * feeding and legal detail sits in `grownUps`. Where a study used pets or
 * another country, `factDetail` says so.
 */

const sourceSchema = z.object({
  label: z.string().min(1),
  url: z.url({ protocol: /^https$/ }),
});

const neighbourSchema = z.object({
  id: z.string().regex(/^[a-z-]+$/),
  name: z.string().min(1),
  latin: z.string().min(1),
  imageId: z.enum(SITE_IMAGE_IDS),
  /** The front of the card: one short, verified kid fact. */
  fact: z.string().min(1),
  /** The study behind it, in plain words, with its limits. */
  factDetail: z.string().min(1),
  /** A two-to-four-word "kindness superpower". */
  superpower: z.string().min(1),
  /** Things a child can do. */
  good: z.array(z.string().min(1)).min(1).max(3),
  /** Things to never do, including the child-safety line. */
  avoid: z.array(z.string().min(1)).min(1).max(3),
  /** For parents and teachers: rules and context. */
  grownUps: z.string().min(1),
  sources: z.array(sourceSchema).min(1),
  quoteId: z.enum(QUOTE_IDS as [string, ...string[]]).optional(),
});

export type Neighbour = z.infer<typeof neighbourSchema>;

const PCA = {
  label: "Prevention of Cruelty to Animals Act, 1960 (India Code)",
  url: "https://indiacode.nic.in/bitstream/123456789/11237/1/the_prevention_of_cruelty_to_animals_act,_1960.pdf",
};

export const NEIGHBOURS: readonly Neighbour[] = z
  .array(neighbourSchema)
  .length(10)
  .parse([
    {
      id: "indie-dog",
      name: "Indie dog",
      latin: "Canis familiaris",
      imageId: "dog-thrissur-happy-white",
      fact: "Street dogs can follow a pointing finger, with no training at all.",
      factDetail:
        "Scientists tested 160 street dogs in Indian cities. About half were too shy to come near a stranger. Of the dogs that did, about 8 in 10 followed a pointing finger to the right bowl.",
      superpower: "Be a tree",
      good: [
        "If a dog runs up, be a tree: stand still, fold your arms and look at your feet. Then tell a grown-up.",
        "Watch dogs from far away. They like to watch new people first, too.",
      ],
      avoid: [
        "Never touch a dog you don’t know. Stay away from dogs that are eating, sleeping or with puppies.",
        "Never tease, chase or throw things at a dog.",
      ],
      grownUps:
        "Feed only at the spot your municipality or residents’ association has set, away from where children play (ABC Rules 2023, Rule 20). The Supreme Court has barred feeding on streets (order of 22 August 2025). Support sterilise–vaccinate–return through recognised organisations, and vaccinate your own dog every year. Hurting or tormenting a dog is cruelty under the PCA Act, s.11.",
      sources: [
        {
          label: "Bhattacharjee et al., Frontiers in Psychology, 2020",
          url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC6978287/",
        },
        {
          label: "The Hindu on the ABC Rules 2023 feeding spots, 3 May 2023",
          url: "https://www.thehindu.com/news/cities/mumbai/societies-and-feeders-welcome-dedicated-place-and-time-to-feed-stray-animals/article66808188.ece",
        },
        PCA,
      ],
    },
    {
      id: "street-cat",
      name: "Street cat",
      latin: "Felis catus",
      imageId: "kitten-tree-dingore",
      fact: "A slow blink is a cat’s friendly hello. Blink slowly at a cat from far away, and it may blink back.",
      factDetail:
        "Tested on pet cats in the UK, not street cats. Cats narrowed their eyes back at people who blinked slowly, and were more likely to come up to a stranger after a slow blink.",
      superpower: "The slow blink",
      good: [
        "Say hello with a slow blink, from far away.",
        "Leave kittens where they are. Their mother is usually close by, waiting for you to go.",
      ],
      avoid: [
        "Don’t chase or pick up cats. If a cat scratches you, tell a grown-up and wash it for 15 minutes.",
        "No milk. Most grown-up cats can’t digest it. Fresh water is best.",
      ],
      grownUps:
        "Leave fresh water, not milk: most adult cats are lactose intolerant. Before deciding kittens are orphaned, watch from hiding for several hours, even a day. Support sterilisation: AWBI issued guidelines for stray cats in 2021. A cat scratch can pass on rabies, so treat it like a bite.",
      sources: [
        {
          label: "Humphrey et al., Scientific Reports, 2020",
          url: "https://www.nature.com/articles/s41598-020-73426-0",
        },
        {
          label: "Cats Protection, “Are cats lactose intolerant?”",
          url: "https://www.cats.org.uk/cats-blog/are-cats-lactose-intolerant",
        },
        {
          label: "Alley Cat Allies, finding kittens outdoors",
          url: "https://www.alleycat.org/community-cat-care/finding-kittens-outdoors/",
        },
      ],
    },
    {
      id: "cow",
      name: "Cow",
      latin: "Bos indicus",
      imageId: "sn-cow-udaipur-0837",
      fact: "Indian cows have a hump on their shoulders. Scientists still aren’t sure what it is for.",
      factDetail:
        "The FAO calls the hump the trait that most clearly separates zebu cattle from European cattle, and says its function “is not clearly understood”.",
      superpower: "Bin it right",
      good: [
        "Put food waste in a closed bin, never in a plastic bag on the street.",
        "Stay a few big steps away, where the cow can see you.",
      ],
      avoid: [
        "Never walk behind a cow, touch a bull’s horns, or shout and wave.",
        "Sweets, rotis and rice are not treats. Too much can make a cow very ill.",
      ],
      grownUps:
        "Plastic builds up in a cow’s stomach: vets removed about 40 kg from one stray cow in Odisha in 2025. Too many sweets or grains on festival days can cause rumen acidosis, which can kill. For an injured cow, call your state’s 1962 mobile veterinary unit where it runs, or a local animal welfare organisation.",
      sources: [
        {
          label: "FAO, Crossbreeding Bos indicus and Bos taurus",
          url: "https://www.fao.org/4/t0095e/T0095E04.htm",
        },
        {
          label: "Priyanka & Dey, Veterinary World, 2018",
          url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC6200578/",
        },
        {
          label: "The Hindu, vets on sweet pongal and cows",
          url: "https://www.thehindu.com/news/national/tamil-nadu/too-much-sweet-pongal-not-good-for-cows-say-veterinarians/article38262804.ece",
        },
      ],
    },
    {
      id: "house-crow",
      name: "House crow",
      latin: "Corvus splendens",
      imageId: "sn-crow-mumbai-grill",
      fact: "Crows can remember a face for years. In a study of American crows, they still scolded a “scary” mask almost three years later.",
      factDetail:
        "The study was on American crows in Seattle. 2.7 years after the trapping stopped, two in three crows still scolded the mask, and young crows learned it from their parents. House crows have not been tested this way.",
      superpower: "Water-bowl keeper",
      good: [
        "Keep a wide, shallow water bowl on your balcony. Change the water every day.",
        "Watch crows from a distance. They are clever city cleaners.",
      ],
      avoid: [
        "Never touch a crow, alive or dead. If you see a dead one, tell a grown-up and wash your hands.",
        "Don’t throw stones or disturb nests.",
      ],
      grownUps:
        "Scrub water bowls once a week so mosquitoes can’t breed. If you see several dead crows or other birds in one place, don’t touch them: report them to the local veterinary or animal husbandry office (bird flu risk).",
      sources: [
        {
          label: "Cornell, Marzluff & Pecoraro, Proc. R. Soc. B, 2012",
          url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC3234554/",
        },
        {
          label: "News9live, Tamil Nadu public health advisory, 5 Feb 2026",
          url: "https://www.news9live.com/state/tamil-nadu/chennai-public-health-dept-issues-advisory-as-crow-deaths-in-city-linked-to-h5n1-bird-flu-virus-2926938",
        },
      ],
    },
    {
      id: "common-myna",
      name: "Common myna",
      latin: "Acridotheres tristis",
      imageId: "sn-myna-goregaon",
      fact: "Mynas walk. Watch closely: sparrows hop, but mynas stroll.",
      factDetail:
        "The common myna prefers walking when it looks for food on the ground. Myna pairs stay together all year, and possibly for life. At sunset, scores to thousands meet at one noisy roost.",
      superpower: "Roost reporter",
      good: [
        "At sunset, count the mynas flying home to roost.",
        "Grow native plants. They bring the insects mynas eat.",
      ],
      avoid: [
        "Don’t touch birds or their nests. Wash your hands after you fill a bird bowl.",
        "Never keep a wild bird in a cage.",
      ],
      grownUps:
        "AWBI’s advisory of 22 July 2021 asks for the ban on keeping wild birds in cages to be enforced. Mynas are native to southern Asia; elsewhere they are a listed invasive species, which is a good classroom talk about why we don’t move animals around.",
      sources: [
        {
          label: "Cornell Lab, All About Birds: Common Myna",
          url: "https://www.allaboutbirds.org/guide/Common_Myna/lifehistory",
        },
      ],
    },
    {
      id: "rock-pigeon",
      name: "Rock pigeon",
      latin: "Columba livia",
      imageId: "sn-pigeon-balcony",
      fact: "Pigeons can be art experts. In a test, they learned to tell Monet’s paintings from Picasso’s, even ones they had never seen.",
      factDetail:
        "In a 1995 lab study in Japan, pigeons also sorted painters they had never seen: Cézanne and Renoir went with Monet, Braque and Matisse with Picasso.",
      superpower: "String sweeper",
      good: [
        "With a grown-up, pick up loose kite string so pigeons don’t get tangled.",
        "Fly kites only with plain cotton thread.",
      ],
      avoid: [
        "Don’t touch pigeons or their droppings. Wash your hands after being near a place where many pigeons sit.",
      ],
      grownUps:
        "Don’t scatter grain for big flocks. Mumbai closed its pigeon feeding spots in 2025 after medical evidence that droppings and feathers can cause lung disease, and several Maharashtra cities restrict feeding. In Gujarat’s 2026 kite season, most of the birds treated for thread injuries were pigeons.",
      sources: [
        {
          label: "Watanabe, Sakamoto & Wakita, JEAB, 1995",
          url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC1334394/",
        },
        {
          label: "Hindustan Times, Bombay High Court on pigeon feeding",
          url: "https://www.hindustantimes.com/india-news/bombay-high-court-directs-action-against-illegal-feeding-of-pigeons-101753954349496.html",
        },
        {
          label: "DD News, Karuna Abhiyan 2026",
          url: "https://ddnews.gov.in/en/over-1-18-lakh-injured-birds-rescued-in-gujarat-since-launch-of-karuna-abhiyan",
        },
      ],
    },
    {
      id: "house-sparrow",
      name: "House sparrow",
      latin: "Passer domesticus",
      imageId: "sn-sparrow-coimbatore",
      fact: "Sparrows have lived beside farmers for about 10,000 years. Their bodies even changed to digest grain.",
      factDetail:
        "A 2018 genetics study found house sparrows split from their wild cousins about 11,000 years ago, as farming spread, with changes in a gene that digests starch.",
      superpower: "Leave a wild corner",
      good: [
        "Leave a wild, weedy corner. The bugs that live there feed sparrow babies.",
        "Keep a shallow water bowl out, and change the water every day.",
      ],
      avoid: [
        "Never touch a nest, an egg or a chick. Watch from far away.",
        "Bread is not good bird food.",
      ],
      grownUps:
        "Grow native shrubs, use fewer pesticides and put up a nest box. Sparrows have not vanished from India, but they have declined in big cities. The popular theory about mobile towers “is not supported by current evidence” (State of India’s Birds 2020). The house sparrow is protected under the Wild Life (Protection) Act: don’t cage it.",
      sources: [
        {
          label: "Ravinet et al., Proc. R. Soc. B, 2018",
          url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC6111181/",
        },
        {
          label: "State of India’s Birds 2020",
          url: "https://stateofindiasbirds.in/wp-content/uploads/SOIB_2020_report.pdf",
        },
      ],
      quoteId: "Q34",
    },
    {
      id: "black-kite",
      name: "Black kite",
      latin: "Milvus migrans",
      imageId: "sn-kite-bengaluru",
      fact: "Some black kites that spend winter in Delhi fly over the Himalayas, more than 6 km up in the sky.",
      factDetail:
        "Scientists put GPS tags on black-eared kites in Delhi. They flew 3,300 to 4,800 km to breed in Kazakhstan and nearby, crossing the Himalayas at over 6,500 m.",
      superpower: "Sky watcher",
      good: [
        "Count kites from the ground.",
        "Fly kites only with plain cotton thread, and not at dawn or dusk.",
      ],
      avoid: [
        "Never touch a kite bird, even a hurt one. Its claws are sharp. Tell a grown-up.",
      ],
      grownUps:
        "Delhi hosts the largest concentration of raptors in the world. For a grounded or tangled kite, call a rescue: don’t pull the string, let a trained rescuer cut it.",
      sources: [
        {
          label: "Kumar et al., Scientific Reports, 2020",
          url: "https://www.nature.com/articles/s41598-020-72970-z",
        },
      ],
    },
    {
      id: "palm-squirrel",
      name: "Palm squirrel",
      latin: "Funambulus palmarum, F. pennantii",
      imageId: "sn-squirrel-kolkata",
      fact: "A squirrel’s front teeth never stop growing.",
      factDetail:
        "Palm squirrels have “chisel sharp teeth that grow constantly” (NSW Department of Primary Industries). In the north you mostly see five-striped palm squirrels; in the south, three-striped ones.",
      superpower: "Stripe spotter",
      good: [
        "Count the stripes. Three or five? That tells you which palm squirrel lives near you.",
        "Keep a shallow water dish out.",
      ],
      avoid: [
        "Don’t try to touch or catch a squirrel. Squirrels can bite.",
        "No sweets or fried snacks.",
      ],
      grownUps:
        "Leave nests in trees and roofs alone. Don’t catch or cage squirrels. If a squirrel bites or scratches someone, follow the bite first aid on this page.",
      sources: [
        {
          label: "NSW DPI, Indian palm squirrel",
          url: "https://dpird.nsw.gov.au/dpi/biosecurity/invasive-plants-and-animals/pest-animals/Managing-new-exotic-animal-incursions/Information-on-animals-that-are-illegal-to-keep-or-deal-with/indian-palm-squirrel",
        },
        {
          label:
            "Climate-driven habitat shifts of two palm squirrels, Biology, 2025",
          url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC12730107/",
        },
      ],
    },
    {
      id: "asian-koel",
      name: "Asian koel",
      latin: "Eudynamys scolopaceus",
      imageId: "sn-koel-figs",
      fact: "Koels never build nests. A mother koel lays her egg in a crow’s nest, and the crows raise the chick.",
      factDetail:
        "The koel chick does not push the crow chicks out: they usually grow up side by side. Male koels are glossy black with red eyes; females are brown with white spots.",
      superpower: "Song detective",
      good: [
        "Learn the male koel’s loud “ko-EL” song. You hear it most from spring to the rains.",
        "Plant a fig or another native fruit tree. Grown-up koels eat mostly fruit.",
      ],
      avoid: ["Don’t climb trees to look for nests. Listen from the ground."],
      grownUps:
        "The Asian koel is a “non-evicting” brood parasite of house crows and jungle crows in India. Adults eat fruit such as figs and berries, plus insects.",
      sources: [
        {
          label: "Nahid et al., 2021 (PMC8270166)",
          url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC8270166/",
        },
        {
          label: "eBird, Asian Koel",
          url: "https://ebird.org/species/asikoe2",
        },
      ],
    },
  ]);

export function neighbour(id: string): Neighbour {
  const found = NEIGHBOURS.find((n) => n.id === id);
  if (!found) throw new Error(`Unknown street neighbour: ${id}`);
  return found;
}
