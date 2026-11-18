import type { ArticleBody } from "../model";

// Brief: research/stories.md §4 A; dossier S9. Kids' article: FK grade ≤ 6
// outside the grown-ups' box (checked in text.test.ts).
export const article = {
  blocks: [
    {
      type: "paragraph",
      text: [
        "Some birds are small enough to sit on your finger. This one is not. The greater adjutant stork stands nearly five feet tall. That is about as tall as a grown-up. When it opens its wings, they stretch eight feet from tip to tip.",
        { fn: "f2" },
      ],
    },
    {
      type: "paragraph",
      text: [
        "For a long time, people did not like this bird at all. Then something changed. Today, a whole army of women looks after it. They even throw parties for its babies.",
      ],
    },
    { type: "heading", level: 2, text: "A very tall bird with a bad name" },
    {
      type: "paragraph",
      text: [
        "In Assam, people call this stork ",
        { em: "hargila" },
        ". The word means “bone swallower”.",
        { fn: "f1" },
        " Many people thought the bird was dirty and smelly. Nobody wanted it near their home.",
        { fn: "f1" },
      ],
    },
    {
      type: "paragraph",
      text: [
        "Some people even said the stork was a bad omen. An omen is a sign that is meant to tell you what will happen next. A bad omen means bad luck. So when storks built nests in tall trees near houses, people cut some of those trees down.",
        { fn: "f3" },
      ],
    },
    { type: "heading", level: 2, text: "The girl who sang to storks" },
    {
      type: "paragraph",
      text: [
        "Purnima Devi Barman grew up in Assam. When she was a little girl, her grandmother taught her songs about birds.",
        { fn: "f5" },
        " Years later, she said this about her grandmother:",
      ],
    },
    {
      type: "sourceQuote",
      text: "She asked me to sing for the egrets and the storks. I fell in love with the birds.",
      attribution: "Purnima Devi Barman, UNEP Champions of the Earth, 2022",
      fn: "f5",
    },
    {
      type: "paragraph",
      text: [
        "She grew up to study birds. She learned that the hargila was in danger. So she went to three villages in Kamrup, Assam, where many storks had their nests: Dadara, Pachariya and Singimari.",
        { fn: "f1" },
      ],
    },
    {
      type: "heading",
      level: 2,
      text: "“What if these were your babies?”",
    },
    {
      type: "paragraph",
      text: [
        "Purnima did not shout or scold. She went from home to home and talked with the women. She asked them to think of their own babies. How would they feel if people treated their babies the way they treated the stork chicks?",
        { fn: "f3" },
      ],
    },
    {
      type: "paragraph",
      text: [
        "A chick is a baby bird. A nest is its home. The women began to see the chicks in a new way: as babies who needed care. Slowly, more and more of them wanted to help.",
        { fn: "f3" },
      ],
    },
    { type: "heading", level: 2, text: "A party for baby storks" },
    {
      type: "paragraph",
      text: [
        "Have you ever been to a baby shower? It is a party to welcome a new baby. The women began to hold baby showers for the storks, to welcome the new chicks.",
        { fn: "f1" },
        " The first one was for the chicks born in 2009.",
        { fn: "f4" },
      ],
    },
    {
      type: "paragraph",
      text: [
        "At these parties, the women sing songs about the hargila. Some dress up as storks, with a huge beak high over their heads, and dance.",
        { fn: "f3" },
      ],
    },
    {
      type: "paragraph",
      text: [
        "The women call their group the Hargila Army. They guard the trees where the storks build nests. If a chick falls out of its nest and gets hurt, they help it get well.",
        { fn: "f1" },
      ],
    },
    { type: "heading", level: 2, text: "Storks on cloth" },
    {
      type: "paragraph",
      text: [
        "Many of the women weave cloth. Now they weave pictures of storks into the cloth they make, and they sell it.",
        { fn: "f1" },
        " A bird that people once wanted to chase away is now part of their art.",
      ],
    },
    { type: "heading", level: 2, text: "More storks than before" },
    {
      type: "paragraph",
      text: [
        "All this care has worked. In the three villages, there were once 28 nests. Now there are more than 250. No other place in the world has so many nests of this stork.",
        { fn: "f1" },
      ],
    },
    {
      type: "paragraph",
      text: [
        "In all of Assam, there were about 450 of these storks in 2007. Now there are more than 1,800.",
        { fn: "f3" },
        " Scientists who track rare animals have moved the stork to a safer group on their list.",
        { fn: "f7" },
        " It still needs care, but it is doing better.",
      ],
    },
    {
      type: "paragraph",
      text: [
        "Today the Hargila Army has about 20,000 women from 47 villages.",
        { fn: "f3" },
        " It all began with songs, a kind question and a party.",
      ],
    },
    {
      type: "callout",
      tone: "info",
      title: "For grown-ups",
      body: [
        [
          "The greater adjutant (",
          { em: "Leptoptilos dubius" },
          ") nests in colonies in tall trees beside homes in Kamrup district. UNEP reported in 2022 that nests in Dadara, Pachariya and Singimari had risen from 28 to more than 250, the largest breeding colony of the species in the world.",
          { fn: "f1" },
          " Assam’s estimate rose from about 450 birds in 2007 to more than 1,800; other reports use a different baseline, so we quote these two together.",
          { fn: "f6" },
          " The IUCN has moved the species from Endangered to Near Threatened, so it is not “saved”.",
          { fn: "f7" },
        ],
        [
          "Purnima Devi Barman works with the conservation group Aaranyak. She was named a UNEP Champion of the Earth in 2022 and won a Whitley Gold Award in 2024.",
          { fn: "f6" },
          " Since 2017 her team has also built tall bamboo nesting platforms.",
          { fn: "f1" },
          " Friends of Animals has no link with the Hargila Army or Aaranyak; we tell this story because it shows how a community’s view of an animal can change.",
        ],
      ],
    },
    {
      type: "callout",
      tone: "success",
      title: "What you can do this week",
      body: [
        [
          "Watch birds from a window or balcony for five minutes. Draw one, and give it a kind name.",
        ],
        [
          "Draw a bird border for a scarf or a sari on paper, the way the Hargila weavers put storks on cloth.",
        ],
        [
          "If you spot a nest, enjoy it from far away. Ask the grown-ups at home not to trim that tree or bush until the chicks have flown.",
        ],
      ],
    },
  ],
  footnotes: [
    {
      id: "f1",
      text: "UNEP, “Biologist devotes career to saving bone-swallowing stork”, 23 Nov 2022",
      url: "https://www.unep.org/en/news-and-stories/story/biologist-devotes-career-saving-bone-swallowing-stork",
    },
    {
      id: "f2",
      text: "BusinessLine, “Purnima Devi Barman’s Hargila Army gives wings to an endangered bird”, 22 Sep 2026",
      url: "https://www.thehindubusinessline.com/news/purnima-devi-barmans-hargila-army-gives-wings-to-an-endangered-bird/article71496834.ece",
    },
    {
      id: "f3",
      text: "BBC Future, “The protectors of India’s greater adjutant storks”, 30 Jan 2026",
      url: "https://www.bbc.com/future/article/20260128-the-protectors-of-indias-greater-adjutant-storks",
    },
    {
      id: "f4",
      text: "Audubon, “How baby showers are helping restore endangered storks’ sullied reputation”, Spring 2020",
      url: "https://www.audubon.org/magazine/how-baby-showers-are-helping-restore-endangered-storks-sullied-reputation",
    },
    {
      id: "f5",
      text: "UNEP Champions of the Earth, laureate page: Dr Purnima Devi Barman, 2022",
      url: "https://www.unep.org/championsofearth/laureates/2022/dr-purnima-devi-barman",
    },
    {
      id: "f6",
      text: "Whitley Fund for Nature, “Meet the 2024 Whitley Award winners”, 2 May 2024",
      url: "https://whitleyaward.org/2024/05/02/meet-the-2024-whitley-award-winners",
    },
    {
      id: "f7",
      text: "Mongabay, “In India, folklore is a tool that helps women save the greater adjutant stork”, 15 May 2025",
      url: "https://news.mongabay.com/2025/05/in-india-folklore-is-a-tool-that-helps-women-save-the-greater-adjutant-stork/",
    },
  ],
} satisfies ArticleBody;
