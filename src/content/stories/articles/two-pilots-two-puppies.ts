import type { ArticleBody } from "../model";

// Brief: research/stories.md §4 C; dossier S3 and india-anchors §10.2. Told as
// history: no link to today's court orders on street dogs (stories.md S3).
export const article = {
  blocks: [
    {
      type: "paragraph",
      text: [
        "It was raining in Madras in 1959. On a flooded road near his home in T. Nagar, Captain V. Sundaram saw two puppies struggling to stay afloat. He could not walk away. He took them home.",
        { fn: "f1" },
        { fn: "f2" },
      ],
    },
    {
      type: "paragraph",
      text: [
        "That small decision is where Blue Cross of India began.",
        { fn: "f1" },
      ],
    },
    { type: "heading", level: 2, text: "A wet afternoon in T. Nagar" },
    {
      type: "paragraph",
      text: [
        "Captain Sundaram was a pilot. So was his wife, Usha.",
        { fn: "f2" },
        " The Times of India has described her as the first Indian woman pilot of independent India.",
        { fn: "f7" },
        " They lived in T. Nagar with their three children, Suresh, Chinny Krishna and Vijayalakshmi.",
        { fn: "f2" },
      ],
    },
    {
      type: "paragraph",
      text: [
        "Two wet puppies in a family home might have stayed a small story. This family kept saying yes.",
      ],
    },
    {
      type: "heading",
      level: 2,
      text: "Shaggy, Grimmy and a house full of animals",
    },
    {
      type: "paragraph",
      text: [
        "The first two puppies were called Shaggy and Grimmy, Chinny Krishna told The Hindu many years later.",
        { fn: "f3" },
        " They were not alone for long. At one point the house held 60 animals: cats, dogs, goats, bandicoots, and even a pair of baby mongooses rescued from a snake charmer.",
        { fn: "f1" },
      ],
    },
    {
      type: "sourceQuote",
      text: "My mother had to cook for 50-60 animals some days",
      attribution: "S. Chinny Krishna, to The Hindu, 2021",
      fn: "f3",
    },
    { type: "heading", level: 2, text: "Kennels built by children" },
    {
      type: "paragraph",
      text: [
        "Sixty animals need somewhere to sleep. Usha and the children built the first few kennels with their own hands.",
        { fn: "f1" },
      ],
    },
    {
      type: "paragraph",
      text: [
        "The family and their friends formed an informal group, the Animal Aid Association.",
        { fn: "f1" },
        " According to WellBeing International, Chinny Krishna was almost 15 at the time, and he and his parents were three of its four founding members.",
        { fn: "f4" },
        " A teenager helped to start it.",
      ],
    },
    {
      type: "heading",
      level: 2,
      text: "From a family home to Blue Cross of India",
    },
    {
      type: "paragraph",
      text: [
        "In 1964 the group took a new name, Blue Cross of India, and was registered as a society with nine founding members.",
        { fn: "f1" },
        " For more than twenty years after that, until 1987, it ran entirely on volunteers.",
        { fn: "f3" },
      ],
    },
    {
      type: "paragraph",
      text: [
        "Madras was becoming a home for animal welfare work in other ways too. The Animal Welfare Board of India was set up in the city in 1962, under the new Prevention of Cruelty to Animals Act, 1960.",
        { fn: "f3" },
      ],
    },
    {
      type: "sourceQuote",
      text: "There are so many charitable institutions for human beings, but so few for animals.",
      attribution: "Captain V. Sundaram, quoted by Blue Cross of India",
      fn: "f1",
    },
    { type: "heading", level: 2, text: "A kinder answer for street dogs" },
    {
      type: "paragraph",
      text: [
        "In the mid-1960s, Blue Cross began a campaign for animal birth control as an alternative to killing street dogs.",
        { fn: "f4" },
        " The idea is simple to say and hard to do: sterilise and vaccinate the dogs, so that fewer puppies are born on the streets and fewer dogs carry rabies.",
        { fn: "f4" },
      ],
    },
    {
      type: "paragraph",
      text: [
        "It took decades. By Blue Cross’s own account, Madras stopped killing street animals in 1996,",
        { fn: "f5" },
        " and animal birth control became a legal requirement in India in 2001.",
        { fn: "f6" },
      ],
    },
    {
      type: "paragraph",
      text: [
        "Rules about street dogs are still argued over in India today, and they change. This is the story of how one family’s idea started, not advice about the dogs on your road. What it shows is older and simpler: big, lasting kindness often begins with one person who will not walk past.",
      ],
    },
    {
      type: "callout",
      tone: "info",
      title: "How we checked this story",
      body: [
        [
          "The founding story comes from Blue Cross of India’s own history and two reports in The Hindu.",
          { fn: "f1" },
          { fn: "f2" },
          " The puppies’ names come from one family interview, so we name the source.",
          { fn: "f3" },
          " Sources give 1964, 1965 or 1966 for the start of the birth-control campaign, so we say “the mid-1960s”. The 1996 and 2001 dates are Blue Cross’s own account. Friends of Animals has no link with Blue Cross of India.",
        ],
      ],
    },
    {
      type: "callout",
      tone: "success",
      title: "What you can do this week",
      body: [
        [
          "Find your city’s animal rescue helpline with a grown-up, and save it in a family phone before you need it.",
        ],
        [
          "Learn “see, stay back, tell”: if an animal looks hurt, keep your distance, tell an adult, and let the adult call the helpline.",
        ],
        [
          "Make a thank-you card for the people at a local animal hospital or shelter, and post it with a grown-up’s help.",
        ],
      ],
    },
  ],
  footnotes: [
    {
      id: "f1",
      text: "Blue Cross of India, “Who We Are”",
      url: "https://bluecrossofindia.org/Who-We-Are.html",
    },
    {
      id: "f2",
      text: "The Hindu, “How Animal Aid Association in Madras became Blue Cross of India”, 2 Jan 2026 (updated 20 Jul 2026)",
      url: "https://www.thehindu.com/news/national/tamil-nadu/how-animal-aid-association-in-madras-became-blue-cross-of-india/article70459968.ece",
    },
    {
      id: "f3",
      text: "The Hindu, “Madras: love for all creatures great and small”, 21 Aug 2021",
      url: "https://www.thehindu.com/news/cities/chennai/madras-love-for-all-creatures-great-and-small/article36039517.ece",
    },
    {
      id: "f4",
      text: "WellBeing International, “Blue Cross of India: pioneering animal welfare and rabies control for 60 years”, 30 Sep 2024",
      url: "https://wellbeingintl.org/blue-cross-of-india-pioneering-animal-welfare-and-rabies-control-for-60-years",
    },
    {
      id: "f5",
      text: "Blue Cross of India, home page timeline",
      url: "https://bluecrossofindia.org/",
    },
    {
      id: "f6",
      text: "Blue Cross of India, 44th Annual Report 2007–08",
      url: "http://bluecrossofindia.org/downloads/annual_report_2008.pdf",
    },
    {
      id: "f7",
      text: "The Times of India, “A pioneering woman pilot from Bengaluru who flew rescue missions during Partition”, 29 Sep 2020",
      url: "https://timesofindia.indiatimes.com/city/bengaluru/a-pioneering-woman-pilot-from-bengaluru-who-flew-rescue-missions-during-partition/articleshow/78347060.cms",
    },
  ],
} satisfies ArticleBody;
